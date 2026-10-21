#!/usr/bin/env python3
"""
PeopleOSHR insert-only BioTime sync.
Run on a PC that can reach BioTime. Setup:
  python -m pip install playwright
  python -m playwright install chromium
Usage:
  python scripts/sync_biotime_attendance.py --from 2026-10-01 --to 2026-10-16
Add --commit to append missing backend records. Default is preview only.
Automatic mode requires BIOTIME_USER, BIOTIME_PASS, PEOPLEOS_USER, PEOPLEOS_PASS.
Requires updated backend/GAS_payroll.js deployed to Google Apps Script.
Matches only Employee ID to the staff master Biometric ID.
Names and departments from BioTime are not sent. No Excel/CSV is created.
"""
import argparse
import csv
import datetime as dt
import os
import re
import sys
import time
import json
import getpass
import urllib.request
import urllib.parse
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BIOTIME_URL", "http://biotime.metrio.com.my:8082")
COLUMNS = ["Employee ID", "First Name", "Department", "Date", "Weekday",
           "First Punch", "Last Punch", "Total Time"]

# JSON key candidates (BioTime versions differ slightly) -> output column
KEY_MAP = {
    "Employee ID": ["emp_code", "employee_id", "emp_id", "pin"],
    "First Name": ["first_name", "emp_name", "name"],
    "Department": ["dept_name", "department", "dept"],
    "Date": ["att_date", "date", "check_date"],
    "Weekday": ["weekday", "week_day"],
    "First Punch": ["clock_in", "first_punch", "first_time", "check_in"],
    "Last Punch": ["clock_out", "last_punch", "last_time", "check_out"],
    "Total Time": ["total_time", "work_time", "duration"],
}


def parse_args():
    today = dt.date.today()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--from", dest="date_from", default=str(today - dt.timedelta(days=1)), help="YYYY-MM-DD (default: yesterday)")
    p.add_argument("--to", dest="date_to", default=str(today), help="YYYY-MM-DD (default: today)")
    p.add_argument("--departments", default="BKT2SQ,LA VIE", help='Comma separated department names as shown in the tree, e.g. "BKT2SQ,LA VIE"')
    p.add_argument("--out", default="outputs", help="Output folder (default: outputs)")
    p.add_argument("--headed", action="store_true", help="Show the browser window")
    p.add_argument("--keep-open-on-error", action="store_true", help="Pause on browser errors for debugging only")
    p.add_argument("--search-selector", default="", help="Optional exact CSS selector for report search")
    p.add_argument("--commit", action="store_true", help="Append missing records to backend (default: preview only)")
    p.add_argument("--api-url", default=os.environ.get("PEOPLEOS_API_URL", ""), help="Apps Script /exec URL; defaults to project VITE_GAS_API_URL")
    p.add_argument("--manual-setup", action="store_true", help="Set report filters manually, then press Enter in this terminal")
    p.add_argument("--manual-login", action="store_true", help="Open browser and allow 5 minutes to log in manually; no environment credentials required")
    p.add_argument("--debug", action="store_true", help="Save screenshots to outputs/debug")
    p.add_argument("--load-timeout", type=int, default=600, help="Seconds to wait for report rows, separately from click/login timeout")
    p.add_argument("--timeout", type=int, default=30, help="Seconds to wait for each step")
    return p.parse_args()


def pick(row, names):
    lower = {str(k).lower(): v for k, v in row.items()}
    for n in names:
        if n in lower and lower[n] not in (None,):
            return lower[n]
    return ""


def normalise(row):
    out = {col: pick(row, keys) for col, keys in KEY_MAP.items()}
    if out["Date"]:
        out["Date"] = str(out["Date"])[:10]
        if not out["Weekday"]:
            try:
                out["Weekday"] = dt.date.fromisoformat(out["Date"]).strftime("%A")
            except ValueError:
                pass
    # punches may come back as full datetimes -> HH:MM
    for col in ("First Punch", "Last Punch"):
        m = re.search(r"(\d{1,2}:\d{2})", str(out[col] or ""))
        out[col] = m.group(1) if m else out[col]
    return out


def looks_like_report_rows(payload):
    """Return list of dict rows if the JSON looks like the First&Last grid data."""
    rows = None
    if isinstance(payload, dict):
        for key in ("data", "results", "rows", "list"):
            if isinstance(payload.get(key), list):
                rows = payload[key]
                break
    elif isinstance(payload, list):
        rows = payload
    if not rows or not isinstance(rows[0], dict):
        return None
    keys = {str(k).lower() for k in rows[0]}
    if keys & set(KEY_MAP["Employee ID"]) and keys & set(KEY_MAP["Date"]):
        return rows
    return None


def visible_match(scope, selector=None, text=None):
    candidates = (scope.locator(selector) if selector else
                  scope.get_by_text(text, exact=True))
    for i in range(candidates.count()):
        item = candidates.nth(i)
        if item.is_visible():
            return item
    return None


def attendance_menu(page):
    return visible_match(page, text="Attendance")


def save_login_diagnostic(page, folder):
    """Record field structure, never input values or credentials."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    lines = ["Login diagnostic: field values are deliberately omitted."]
    for index, frame in enumerate(page.frames):
        lines.append(f"Frame {index}")
        fields = frame.locator("input")
        for i in range(fields.count()):
            field = fields.nth(i)
            lines.append(str({
                "type": field.get_attribute("type"),
                "id": field.get_attribute("id"),
                "name": field.get_attribute("name"),
                "visible": field.is_visible(),
            }))
    path = folder / "login_diagnostic.txt"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Login diagnostic saved: {path}")


def submit_biotime_tip_login(frame, user, pwd, timeout):
    """Activate the real fields through BioTime's visible placeholder controls."""
    if not frame.locator("#id_login:visible").count():
        return False
    if not frame.locator("#id_username").count() or not frame.locator("#id_password").count():
        return False
    for actual_id, tip_id, value in (
        ("id_username", "id_usernameTip", user),
        ("id_password", "id_passwordTip", pwd),
    ):
        actual = frame.locator("#" + actual_id)
        if not actual.is_visible():
            tip = frame.locator("#" + tip_id + ":visible")
            if not tip.count():
                raise RuntimeError(f"BioTime login field {actual_id} is hidden with no visible placeholder.")
            tip.click()
        actual.wait_for(state="visible", timeout=timeout)
        actual.fill(value)
    if frame.locator("#id_captcha:visible, #id_captchaTip:visible").count():
        raise RuntimeError("BioTime requires a CAPTCHA. Use --manual-login for this session.")
    frame.locator("#id_login:visible").click()
    print("BioTime login submitted.")
    return True


def login(page, timeout, manual=False, debug_dir="outputs/debug"):
    user, pwd = os.environ.get("BIOTIME_USER"), os.environ.get("BIOTIME_PASS")
    if not manual and (not user or not pwd or
                       user == "your-user" or pwd == "your-password"):
        raise RuntimeError(
            "Set real BIOTIME_USER / BIOTIME_PASS values, or use --manual-login."
        )
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=timeout)
    if manual:
        print("Log in to BioTime in the browser. Waiting up to 5 minutes for Attendance.")
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            if attendance_menu(page) is not None:
                return
            page.wait_for_timeout(300)
        save_login_diagnostic(page, debug_dir)
        raise RuntimeError("Manual login timed out: Attendance menu was not visible.")

    # Ignore hidden template fields; also inspect embedded login frames.
    deadline = time.monotonic() + timeout / 1000
    password = None
    scope = None
    submitted = False
    while time.monotonic() < deadline:
        if attendance_menu(page) is not None:
            return
        for frame in page.frames:
            if submit_biotime_tip_login(frame, user, pwd, timeout):
                submitted = True
                break
            password = visible_match(frame, 'input[type="password"]:visible')
            if password is not None:
                scope = frame
                break
        if submitted or password is not None:
            break
        page.wait_for_timeout(250)
    if not submitted and password is None:
        save_login_diagnostic(page, debug_dir)
        raise RuntimeError(
            "No visible password field appeared. Run again with --manual-login "
            "--debug, then complete the login in the browser."
        )

    if not submitted:
        # Prefer the password's own form to avoid unrelated search inputs.
        form = password.locator("xpath=ancestor::form[1]")
        target = form if form.count() else scope
        username = None
        for selector in (
            'input[name="username"]:visible, input#id_username:visible',
            'input[autocomplete="username"]:visible',
            'input[name="login"]:visible, input[name="user"]:visible',
            'input[type="email"]:visible',
            'input[type="text"]:visible, input:not([type]):visible',
        ):
            username = visible_match(target, selector)
            if username is not None:
                break
        if username is None:
            save_login_diagnostic(page, debug_dir)
            raise RuntimeError("No visible username field. Retry using --manual-login.")

        username.fill(user)
        password.fill(pwd)
        submit = visible_match(target, 'button[type="submit"]:visible, input[type="submit"]:visible')
        if submit is not None:
            submit.click()
        else:
            password.press("Enter")

    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if attendance_menu(page) is not None:
            return
        page.wait_for_timeout(250)
    save_login_diagnostic(page, debug_dir)
    raise RuntimeError(
        "Login did not reach the Attendance menu. Check credentials or use "
        "--manual-login for CAPTCHA, extra login steps, or a different login layout."
    )


def wait_visible_text(page, text, timeout):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        for frame in page.frames:
            item = visible_match(frame, text=text)
            if item is not None:
                return item
        page.wait_for_timeout(200)
    raise RuntimeError(f"Could not find visible menu: {text}")


def open_first_last(page, timeout):
    wait_visible_text(page, "Attendance", timeout).click()
    # Do not collapse an already-expanded report group.
    try:
        item = wait_visible_text(page, "First & Last", min(timeout, 2000))
    except RuntimeError:
        wait_visible_text(page, "Transaction Report", timeout).click()
        item = wait_visible_text(page, "First & Last", timeout)
    item.click()
    wait_visible_text(page, "Date Period", timeout)



class ReportLoads:
    """Track only the report endpoint observed in BioTime's supplied HTML."""
    def __init__(self, page):
        self.pending = set()
        self.started = 0
        self.last_activity = time.monotonic()
        self.failure = None
        page.on("request", self.request)
        page.on("requestfinished", self.finished)
        page.on("requestfailed", self.failed)

    def request(self, request):
        if urllib.parse.urlparse(request.url).path.rstrip("/") == "/att/api/firstLastReport":
            self.pending.add(request)
            self.started += 1
            self.last_activity = time.monotonic()

    def finished(self, request):
        if request in self.pending:
            response = request.response()
            if response is not None and response.status >= 400:
                self.failure = f"Report request failed with HTTP {response.status}"
            self.pending.discard(request)
            self.last_activity = time.monotonic()

    def failed(self, request):
        if request in self.pending:
            self.failure = "BioTime report network request failed. Rerun after checking the connection."
            self.pending.discard(request)
            self.last_activity = time.monotonic()

    def wait(self, page, timeout, label, after=None):
        start = time.monotonic()
        notice = start
        while time.monotonic() - start < timeout:
            page.wait_for_timeout(250)
            now = time.monotonic()
            if self.failure:
                raise RuntimeError(self.failure)
            if (after is None or self.started > after) and not self.pending and now - self.last_activity >= 2 and now - start >= 2:
                return
            if now >= notice:
                print(f"Waiting for {label}: {int(now-start)}s / {timeout}s; {len(self.pending)} report request(s) loading.", flush=True)
                notice = now + 10
        raise RuntimeError(f"Timed out waiting for {label} report requests after {timeout}s. No data was sent.")


def report_frame(page):
    for frame in page.frames:
        if frame.locator("#firstLastReport_fluid:visible").count():
            return frame
    raise RuntimeError("First & Last report panel is not visible.")


def department_is_checked(classes):
    # zTree adds _focus while the pointer rests on a checked box.
    return any(re.fullmatch(r"checkbox_true_full(?:_focus)?", token)
               for token in (classes or "").split())


def select_departments(page, names, load_timeout=600):
    page.report_loads.wait(page, load_timeout, "initial report")
    frame = report_frame(page)
    frame.locator("#firstLastReport-tree .node_name").first.wait_for(
        state="visible", timeout=load_timeout * 1000)
    # Use BioTime's own zTree state, with callbacks disabled, then Search once.
    # Clicking each checkbox invokes onCheck -> refreshReport separately.
    selected = frame.evaluate("""(names) => {
        const jq = window.jQuery;
        const tree = jq && jq.fn.zTree && jq.fn.zTree.getZTreeObj('firstLastReport-tree');
        if (!tree) throw new Error('BioTime department tree is not ready');
        const normal = value => String(value || '').replace(/\\s+/g, '').toLowerCase();
        const all = tree.transformToArray(tree.getNodes());
        const targets = names.map(name => {
            const matches = all.filter(node => normal(node.name) === normal(name));
            if (matches.length !== 1) throw new Error('Department missing or ambiguous: ' + name);
            return matches[0];
        });
        // Resolve every requested node before changing any selection.
        tree.setting.check.chkStyle = 'checkbox';
        tree.setting.check.chkboxType = {Y: '', N: ''};
        for (const node of tree.getCheckedNodes(true)) tree.checkNode(node, false, false, false);
        for (const node of targets) tree.checkNode(node, true, false, false);
        const checked = tree.getCheckedNodes(true);
        if (checked.length !== targets.length || targets.some(node => !node.checked))
            throw new Error('BioTime did not retain the requested department selection');
        // Mirror the employee-filter reset performed by BioTime onCheck.
        jq('#firstLastReport-selected-emp-container').val('-1');
        jq('#firstLastReport-employee').val('');
        return checked.map(node => node.name);
    }""", names)
    print("Selected departments together: " + ", ".join(selected) + ". Search will run once after setting dates.", flush=True)


def set_dates_and_search(page, date_from, date_to, search_selector="", load_timeout=600):
    frame = report_frame(page)
    # Layui renders a custom visible control beside its hidden native select.
    period = frame.locator("#firstLastReportDatePeriod")
    if period.input_value() != "0":
        widget = period.locator("xpath=following-sibling::div[1]")
        widget.locator(".layui-select-title").click()
        widget.locator('dd[lay-value="0"]').click()
    dates = [frame.locator("#firstLastReport-start-date"),
             frame.locator("#firstLastReport-end-date")]
    for el, value in zip(dates, (date_from,date_to)):
        el.fill(value)
        el.dispatch_event("input")
        el.dispatch_event("change")
        el.press("Tab")
        if el.input_value() != value:
            raise RuntimeError("BioTime did not retain the requested report dates.")
    actual_dates = [el.input_value().strip() for el in dates]
    if actual_dates != [date_from, date_to] or period.input_value() != "0":
        raise RuntimeError(f"Date verification failed before Search: {actual_dates}")
    print(f"Verified BioTime dates: {date_from} to {date_to} (User Defined)", flush=True)
    button = frame.locator(search_selector or
                           '#firstLastReport-search-form [lay-filter="firstLastReport-search"]')
    print(f"Searching BioTime: {date_from} to {date_to}", flush=True)
    page.report_loads.wait(page, load_timeout, "date filter refresh")
    baseline = page.report_loads.started
    button.click()
    page.report_loads.wait(page, load_timeout, "requested date search", after=baseline)



def go_to_report_page(frame, number):
    # The observed BioTime pager has a page-number input beside Confirm.
    confirms = frame.locator('.layui-table-view[lay-id="id_grid_firstLastReport"] .layui-laypage-btn')
    for i in range(confirms.count()):
        button = confirms.nth(i)
        if not button.is_visible():
            continue
        for level in range(1, 5):
            parent = button.locator("xpath=" + "/".join([".."] * level))
            inputs = parent.locator("input:visible")
            if inputs.count() != 1:
                continue
            field = inputs.first
            value = field.input_value().strip()
            if not value.isdigit():
                continue
            field.fill(str(number))
            field.dispatch_event("input")
            field.dispatch_event("change")
            button.click()
            return True
    return False



def set_page_size_max(page):
    """Best effort: choose the biggest page size in the pager so fewer pages are needed."""
    try:
        sel = page.locator("select").filter(has=page.locator("option", has_text="20")).first
        if sel.count():
            options = sel.locator("option").all_inner_texts()
            sizes = [int(re.sub(r"\D", "", o)) for o in options if re.sub(r"\D", "", o)]
            if sizes:
                sel.select_option(label=next(o for o in options if str(max(sizes)) in o))
                page.wait_for_timeout(1500)
    except Exception:
        pass


def read_grid(frame):
    root = frame.locator('.layui-table-view[lay-id="id_grid_firstLastReport"]')
    if not root.count():
        return []
    # Read data-field attributes; hidden columns make positional extraction invalid.
    table_rows = root.locator(".layui-table-main tbody tr")
    mapping = {
        "Employee ID":"emp_code", "First Name":"first_name",
        "Department":"dept_name", "Date":"att_date", "Weekday":"weekday",
        "First Punch":"first_punch", "Last Punch":"last_punch", "Total Time":"total_time",
    }
    result = []
    for i in range(table_rows.count()):
        row = table_rows.nth(i)
        record = {}
        for column, field in mapping.items():
            cell = row.locator(f'td[data-field="{field}"]')
            record[column] = cell.inner_text().strip() if cell.count() else ""
        if record["Employee ID"] and re.fullmatch(r"\d{4}-\d{2}-\d{2}", record["Date"]):
            result.append(record)
    return result



def wait_for_report_page(page, frame, previous_signature, number, load_timeout):
    page.report_loads.wait(page, load_timeout, f"page {number}")
    started = time.monotonic()
    deadline = started + load_timeout
    next_notice = started
    while time.monotonic() < deadline:
        updated = read_grid(frame)
        signature = tuple(tuple(r[c] for c in COLUMNS) for r in updated)
        if updated and signature != previous_signature:
            return
        now = time.monotonic()
        if now >= next_notice:
            print(f"Waiting for page {number}: {int(now-started)}s / {load_timeout}s. Browser remains open.", flush=True)
            next_notice = now + 10
        page.wait_for_timeout(500)
    raise RuntimeError(f"Page {number} did not load new rows within {load_timeout} seconds. No data was sent.")


def scrape_verified_pages(page, args):
    frame = None
    started = time.monotonic()
    deadline = started + args.load_timeout
    next_notice = started
    print(f"Waiting up to {args.load_timeout} seconds for report rows...", flush=True)
    while time.monotonic() < deadline:
        for candidate in page.frames:
            if read_grid(candidate):
                frame = candidate
                break
        if frame is not None:
            break
        now = time.monotonic()
        if now >= next_notice:
            print(f"Report not ready: {int(now-started)}s elapsed / {args.load_timeout}s allowed. Browser remains open.", flush=True)
            next_notice = now + 10
        page.wait_for_timeout(500)
    if frame is None:
        diagnostic = Path(args.out) / "debug" / "report_diagnostic.txt"
        diagnostic.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"Elapsed seconds: {int(time.monotonic()-started)}",
                 f"Configured loading timeout: {args.load_timeout}"]
        for i, candidate in enumerate(page.frames):
            lines.append(f"Frame {i}: tables={candidate.locator('table:visible').count()}, "
                         f"table rows={candidate.locator('table:visible tr:has(td)').count()}, "
                         f"ARIA rows={candidate.locator('[role=row]:visible').count()}")
        diagnostic.write_text("\n".join(lines), encoding="utf-8")
        raise RuntimeError(f"No readable attendance rows after {int(time.monotonic()-started)} seconds. See {diagnostic}.")
    text = frame.locator('.layui-table-view[lay-id="id_grid_firstLastReport"] .layui-laypage-count').inner_text()
    total_match = re.search(r"Total\s*([\d,]+)\s*Records", text, re.I)
    if not total_match:
        raise RuntimeError("Cannot read BioTime's Total Records; cannot verify a complete export.")
    expected = int(total_match.group(1).replace(",", ""))
    collected, seen = [], set()
    departments = {d.strip().casefold() for d in args.departments.split(",") if d.strip()}
    for number in range(1, 10001):
        current = read_grid(frame)
        signature = tuple(tuple(r[c] for c in COLUMNS) for r in current)
        if not current or signature in seen:
            raise RuntimeError("Page did not change or contains no rows. Export stopped to avoid an incomplete file.")
        count_text = frame.locator('.layui-table-view[lay-id="id_grid_firstLastReport"] .layui-laypage-count').inner_text()
        count_match = re.search(r"Total\s*([\d,]+)\s*Records", count_text, re.I)
        if not count_match or int(count_match.group(1).replace(",", "")) != expected:
            raise RuntimeError(f"Report total changed during pagination (initial {expected}; now {count_text}). No data was sent. Wait for loading to finish and rerun.")
        seen.add(signature)
        collected.extend(current)
        print(f"Read page {number}: {len(collected)} / {expected} records.")
        if len(collected) == expected:
            return collected
        if len(collected) > expected:
            raise RuntimeError("Read more rows than BioTime's total; check the selected table.")
        if go_to_report_page(frame, number + 1):
            wait_for_report_page(page, frame, signature, number + 1, args.load_timeout)
            continue
        nxt = None
        for selector in (
            ".layui-laypage-next:visible", ".pagination-next:visible",
            "li.next:not(.disabled) a:visible", "button[title='Next']:visible",
            "a[title='Next']:visible", ".ui-icon-seek-next:visible",
        ):
            nxt = visible_match(frame, selector)
            if nxt is not None:
                break
        if nxt is None:
            nxt = visible_match(frame, text=str(number + 1))
        if nxt is not None and nxt.is_enabled() and not re.search(
            r"disabled|laypage-disabled", nxt.get_attribute("class") or "", re.I
        ):
            nxt.click()
        elif args.manual_setup:
            input("Click NEXT PAGE in BioTime, wait for the rows to load, then press Enter here: ")
        else:
            raise RuntimeError("Next-page control not found. Run with --manual-setup.")
        wait_for_report_page(page, frame, signature, number + 1, args.load_timeout)
    raise RuntimeError("Page safety limit reached; no incomplete export was written.")


def main():
    args = parse_args()
    print("BioTime sync build 2026-10-16-dom-v9", flush=True)
    print(f"Running file: {Path(__file__).resolve()}", flush=True)
    if args.load_timeout <= 0:
        raise RuntimeError("--load-timeout must be greater than zero.")
    if args.timeout <= 0:
        sys.exit("--timeout must be greater than zero.")
    try:
        start, end = dt.date.fromisoformat(args.date_from), dt.date.fromisoformat(args.date_to)
    except ValueError:
        sys.exit("Dates must use YYYY-MM-DD.")
    if start > end:
        sys.exit("--from cannot be after --to.")
    if not args.manual_setup and not args.manual_login:
        required = ("BIOTIME_USER", "BIOTIME_PASS", "PEOPLEOS_USER", "PEOPLEOS_PASS")
        missing = [key for key in required if not os.environ.get(key) or os.environ[key] in ("your-user", "your-password")]
        if missing:
            raise RuntimeError("Set environment variables before automatic mode: " + ", ".join(missing))
    timeout = args.timeout * 1000
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    dbg = out_dir / "debug"
    if args.debug:
        dbg.mkdir(exist_ok=True)

    with sync_playwright() as pw:
        interactive = args.headed or args.manual_login or args.manual_setup
        browser = pw.chromium.launch(headless=not interactive)
        page = browser.new_context(viewport={"width": 1600, "height": 900}).new_page()
        page.set_default_timeout(timeout)
        page.report_loads = ReportLoads(page)
        stage = "login"
        try:
            if args.manual_setup:
                page.goto(BASE_URL, wait_until="domcontentloaded", timeout=timeout)
                print("1. Log in, open Attendance > Transaction Report > First & Last.")
                print("2. Select the required employees, or all departments. Names and departments are ignored when matching.")
                print(f"3. Set Date Period to User Defined: {args.date_from} through {args.date_to}.")
                print("4. Click the search icon beside the dates; wait for results, then go to page 1.")
                input("When the report is ready, press Enter HERE in PowerShell: ")
            else:
                login(page, timeout, manual=args.manual_login, debug_dir=dbg)
                stage = "report navigation"
                open_first_last(page, timeout)
                select_departments(page, [d.strip() for d in args.departments.split(",") if d.strip()], args.load_timeout)
                stage = "date filters"
                set_dates_and_search(page, args.date_from, args.date_to, args.search_selector, args.load_timeout)
                page.wait_for_timeout(3000)
            stage = "read and verify report pages"
            rows = scrape_verified_pages(page, args)
        except Exception as exc:
            dbg.mkdir(parents=True, exist_ok=True)
            (dbg / "error.txt").write_text(
                f"Stage: {stage}\n{type(exc).__name__}: {exc}\n", encoding="utf-8"
            )
            print(f"FAILED at {stage}: {exc}", file=sys.stderr)
            print(f"Error details: {dbg / 'error.txt'}")
            if args.keep_open_on_error and interactive and not page.is_closed():
                input("Browser kept open for inspection. Press Enter here when ready to close: ")
            raise RuntimeError(f"Attendance export stopped at: {stage}") from exc
        finally:
            browser.close()

    rows = sorted(rows, key=lambda r: (str(r["Employee ID"]), r["Date"]))
    selected = [r for r in rows if args.date_from <= r["Date"] <= args.date_to]
    print(f"Read {len(rows)} rows; {len(selected)} within requested dates.")
    if not selected:
        raise RuntimeError("No rows in requested date range. Nothing sent.")
    endpoint = args.api_url
    if not endpoint:
        config = Path(__file__).resolve().parent.parent / ".env"
        if config.exists():
            for line in config.read_text(encoding="utf-8-sig").splitlines():
                if line.strip().startswith("VITE_GAS_API_URL="):
                    endpoint = line.split("=",1)[1].strip().strip('"').strip("'")
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != "https" or parsed.hostname != "script.google.com" or not parsed.path.endswith("/exec"):
        raise RuntimeError("Set PEOPLEOS_API_URL to your deployed HTTPS Google Apps Script /exec URL.")
    username = os.environ.get("PEOPLEOS_USER") or input("PeopleOSHR HR/Admin username: ")
    password = os.environ.get("PEOPLEOS_PASS") or getpass.getpass("PeopleOSHR password: ")
    auth = backend_post(endpoint, "login", {"username":username,"password":password})
    token = auth.get("sessionToken")
    if not token:
        raise RuntimeError("Backend did not issue a session token.")
    try:
        payload = {"from":args.date_from,"to":args.date_to,"dryRun":not args.commit,
                   "records":[{"biometricId":r["Employee ID"],"date":r["Date"],
                               "in":r["First Punch"],"out":r["Last Punch"],
                               "totalHrs":r["Total Time"]} for r in selected]}
        result = backend_post(endpoint,"syncBioTimeAttendance",payload,token)
        print(json.dumps(result,indent=2,ensure_ascii=False))
        if not args.commit:
            print("Preview only. Run the same command with --commit to insert missing records.")
        else:
            print("Sync complete. Refresh PeopleOSHR to load the new raw attendance.")
    finally:
        try:
            backend_post(endpoint,"logout",{},token)
        except Exception:
            pass


def backend_post(endpoint, action, payload, token=None):
    body = {"action":action,"payload":payload}
    if token:
        body["sessionToken"] = token
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type":"application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)
    except Exception as exc:
        raise RuntimeError("Backend request failed. No automatic retry: check backend or rerun safely; existing records are skipped.") from exc
    if result.get("status") != "success":
        raise RuntimeError(result.get("message","Backend rejected the request."))
    return result


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, PWTimeout) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
