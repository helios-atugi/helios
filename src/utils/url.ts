// src/utils/url.ts
export const u = (path: string) =>
  new URL(path, import.meta.env.BASE_URL).toString();
