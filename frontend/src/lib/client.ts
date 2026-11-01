import { demoApi } from "../demo";
import { httpApi, tokenStore } from "./api";

export const api = import.meta.env.VITE_DEMO === "true" ? demoApi : httpApi;
export { tokenStore };
