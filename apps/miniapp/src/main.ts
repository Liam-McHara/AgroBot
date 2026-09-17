import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { initTelegram } from './lib/telegram.js';
import { initLanguage } from './lib/i18n/index.svelte.js';

initTelegram();
initLanguage();

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

export default mount(App, { target });
