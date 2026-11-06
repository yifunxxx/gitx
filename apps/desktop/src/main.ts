import { createApp } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import { bootstrapActions } from "./actions";
import en from "./i18n/locales/en.json";
import zhCN from "./i18n/locales/zh-CN.json";
import "./styles/globals.css";

bootstrapActions();

const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en,
    "zh-CN": zhCN,
  },
});

createApp(App).use(createPinia()).use(i18n).mount("#app");
