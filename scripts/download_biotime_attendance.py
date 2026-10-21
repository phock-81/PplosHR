#!/usr/bin/env python3
"""
Download the ZKBioTime "First & Last" attendance report (raw punches) and save it
in the format the HR Portal's "Upload Staff Attendance (Raw Biometric Logs)" accepts.

Navigation mirrors the manual steps:
  1. Attendance (top menu)  2. Transaction Report > First & Last
  3. tick departments       4. set Date Period (from / to)   5. click search

Setup (once):
    pip install playwright openpyxl
    playwright install chromium

Usage (PowerShell):
    $env:BIOTIME_USER = "your-user"; $env:BIOTIME_PASS = "your-password"
    python scripts/download_biotime_attendance.py --from 2026-10-01 --to 2026-10-14 `
        --departments "BKT2SQ,LA VIE"

    # First run / debugging: watch the browser and keep screenshots
    python scripts/download_biotime_attendance.py --headed --debug

Output: outputs/biotime_first_last_<from>_<to>.xlsx (+ .csv)
Columns: Employee ID, First Name, Department, Date, Weekday, First Punch, Last Punch, Total Time

Notes
- Credentials are read from BIOTIME_USER / BIOTIME_PASS env vars (never hard-code them).
- Rows are captured from the grid's own network (JSON) responses when possible and
  fall back to reading the visible table page by page.
- The BioTime host is internal: run this on a PC/VPN that can reach it.
"""
import argparse
import csv
import datetime as dt
import os
import re
import sys
import time
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
    p.add_argument("--departments", default="", help='Comma separated department names as shown in the tree, e.g. "BKT2SQ,LA VIE"')
    p.add_argument("--out", default="outputs", help="Output folder (default: outputs)")
    p.add_argument("--headed", action="store_true", help="Show the browser window")
    p.add_argument("--manual-setup", action="store_true", help="Set report filters manually, then press Enter in this terminal")
    p.add_argument("--manual-login", action="store_true", help="Open browser and allow 5 minutes to log in manually; no environment credentials required")
    p.add_argument("--debug", action="store_true", help="Save screenshots to outputs/debug")
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