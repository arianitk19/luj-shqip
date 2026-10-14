// Only public, non-secret values may live here (Vite inlines VITE_* variables into the bundle).
export const config = Object.freeze({
  apiUrl: (import.meta.env.VITE_API_URL || "http://localhost:2567").replace(/\/$/, ""),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  devAuth: import.meta.env.VITE_DEV_AUTH === "1",
});

export const authMode = config.devAuth ? "dev" : config.supabaseUrl && config.supabaseAnonKey ? "supabase" : "none";
