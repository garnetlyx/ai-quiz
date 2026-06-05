import { create } from "zustand";
import { api } from "../services/api";

interface AuthState {
  user: { id: string; email: string; aiAgent?: string } | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
  setAiAgent: (agent: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  hydrate: () => {
    const user = api.getUser<{ id: string; email: string; aiAgent?: string }>();
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("auth_token")
        : null;
    if (user && token) {
      set({ user, token, isAuthenticated: true });
    }
  },

  setAiAgent: (agent: string) => {
    set((state) => {
      if (!state.user) return state;
      const updated = { ...state.user, aiAgent: agent };
      api.setUser(updated);
      return { user: updated };
    });
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await api.request<{
        user: { id: string; email: string; aiAgent?: string };
        token: string;
      }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      api.setToken(res.token);
      api.setUser(res.user);
      set({
        user: res.user,
        token: res.token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await api.request<{
        user: { id: string; email: string; aiAgent?: string };
        token: string;
      }>("/api/auth/register", {
        method: "POST",
        body: { email, password },
      });
      api.setToken(res.token);
      api.setUser(res.user);
      set({
        user: res.user,
        token: res.token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
    }
    set({ user: null, token: null, isAuthenticated: false });
  },
}));
