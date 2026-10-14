import { mount } from 'svelte';
import '@toolbar/ui/tokens.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
