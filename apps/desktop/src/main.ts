import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { bootstrapActions } from "./actions";
import { i18n } from "./i18n";
import "./styles/globals.css";

bootstrapActions();

createApp(App).use(createPinia()).use(i18n).mount("#app");
