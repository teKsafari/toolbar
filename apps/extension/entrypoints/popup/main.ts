import { mount } from 'svelte';
import '@toolbar/ui/tokens.css';
import './popup.css';
import App from './App.svelte';
import { brandPage } from '../../lib/ui/page-brand.svelte';

brandPage();

mount(App, { target: document.getElementById('app')! });
