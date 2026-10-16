import { mount } from 'svelte';
import '@toolbar/ui/fonts.css';
import '@toolbar/ui/tokens.css';
import App from './App.svelte';
import { brandPage } from '../../lib/ui/page-brand.svelte';

brandPage((n) => `${n} options`);

mount(App, { target: document.getElementById('app')! });
