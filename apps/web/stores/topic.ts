import { create } from "zustand";
import { api } from "../services/api";
import type { Topic, TopicCreateResponse, TopicUpdateRequest } from "@ai-quiz/shared";

interface TopicState {
  topics: Topic[];
  currentTopic: Topic | null;
  isLoading: boolean;
  fetchTopics: () => Promise<void>;
  createTopic: (description: string) => Promise<TopicCreateResponse>;
  fetchTopic: (id: string) => Promise<void>;
  confirmFormat: (
    id: string,
    confirmed: boolean,
    feedback?: string
  ) => Promise<void>;
  updateTopic: (id: string, update: TopicUpdateRequest) => Promise<Topic>;
  deleteTopic: (id: string) => Promise<void>;
}

export const useTopicStore = create<TopicState>((set) => ({
  topics: [],
  currentTopic: null,
  isLoading: false,

  fetchTopics: async () => {
    set({ isLoading: true });
    const topics = await api.request<Topic[]>("/api/topics");
    set({ topics, isLoading: false });
  },

  createTopic: async (description) => {
    return api.request<TopicCreateResponse>("/api/topics", {
      method: "POST",
      body: { description },
    });
  },

  fetchTopic: async (id) => {
    set({ isLoading: true });
    const topic = await api.request<Topic>(`/api/topics/${id}`);
    set({ currentTopic: topic, isLoading: false });
  },

  confirmFormat: async (id, confirmed, feedback) => {
    await api.request(`/api/topics/${id}/confirm-format`, {
      method: "POST",
      body: { confirmed, feedback },
    });
    if (confirmed) {
      const topic = await api.request<Topic>(`/api/topics/${id}`);
      set({ currentTopic: topic });
    }
  },

  updateTopic: async (id, update) => {
    const topic = await api.request<Topic>(`/api/topics/${id}`, {
      method: "PATCH",
      body: update,
    });
    set((state) => ({
      currentTopic: topic,
      topics: state.topics.map((item) => (item.id === id ? topic : item)),
    }));
    return topic;
  },

  deleteTopic: async (id) => {
    await api.request<{ success: true }>(`/api/topics/${id}`, {
      method: "DELETE",
    });
    set((state) => ({
      topics: state.topics.filter((item) => item.id !== id),
      currentTopic: state.currentTopic?.id === id ? null : state.currentTopic,
    }));
  },
}));
