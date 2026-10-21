import { createApp } from 'vue';
import $ from 'jquery';
import * as bootstrap from 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/dashboard.css';
import './styles/workspace.css';
import './styles/hr.css';
import './styles/liquid-glass.css';
import App from './App.vue';
import { initPwa } from './pwa/register.js';

if (typeof window !== 'undefined') {
  window.$ = $;
  window.jQuery = $;
  window.bootstrap = bootstrap;
}

createApp(App).mount('#app');
initPwa();
