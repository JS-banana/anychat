import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ChatService, DEFAULT_SERVICES } from '@/types';

interface AppState {
  services: ChatService[];
  activeServiceId: string | null;
  settingsPageOpen: boolean;
  settingsActiveTab: 'services' | 'data' | 'about';
  addServiceDialogOpen: boolean;

  setActiveService: (id: string) => void;
  addService: (service: Omit<ChatService, 'id' | 'order'>) => void;
  removeService: (id: string) => void;
  updateService: (id: string, updates: Partial<ChatService>) => void;
  toggleServiceEnabled: (id: string) => void;
  reorderServices: (startIndex: number, endIndex: number) => void;
  setSettingsPageOpen: (open: boolean) => void;
  setSettingsActiveTab: (tab: 'services' | 'data' | 'about') => void;
  setAddServiceDialogOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      services: DEFAULT_SERVICES,
      activeServiceId: DEFAULT_SERVICES.find((s) => s.enabled)?.id ?? null,
      settingsPageOpen: false,
      settingsActiveTab: 'services',
      addServiceDialogOpen: false,

      setActiveService: (id) => {
        const service = get().services.find((s) => s.id === id);
        if (service?.enabled) {
          set({ activeServiceId: id });
        }
      },

      addService: (serviceData) => {
        const services = get().services;
        const id = `custom-${Date.now()}`;
        const order = Math.max(...services.map((s) => s.order), -1) + 1;
        const newService: ChatService = {
          ...serviceData,
          id,
          order,
          enabled: true,
        };
        set({ services: [...services, newService] });
      },

      removeService: (id) => {
        const services = get().services.filter((s) => s.id !== id);
        const activeId = get().activeServiceId;
        set({
          services,
          activeServiceId:
            activeId === id ? (services.find((s) => s.enabled)?.id ?? null) : activeId,
        });
      },

      updateService: (id, updates) => {
        set({
          services: get().services.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        });
      },

      toggleServiceEnabled: (id) => {
        const services = get().services.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled } : s
        );
        const activeId = get().activeServiceId;
        const targetService = services.find((s) => s.id === id);

        let newActiveId = activeId;
        if (activeId === id && !targetService?.enabled) {
          newActiveId = services.find((s) => s.enabled)?.id ?? null;
        }

        set({ services, activeServiceId: newActiveId });
      },

      reorderServices: (startIndex, endIndex) => {
        const services = [...get().services];
        const [removed] = services.splice(startIndex, 1);
        services.splice(endIndex, 0, removed);
        set({
          services: services.map((s, i) => ({ ...s, order: i })),
        });
      },

      setSettingsPageOpen: (open) => set({ settingsPageOpen: open }),
      setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
      setAddServiceDialogOpen: (open) => set({ addServiceDialogOpen: open }),
    }),
    {
      name: 'chat-box-app-storage',
      partialize: (state) => ({
        services: state.services,
        activeServiceId: state.activeServiceId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppState>;
        const persistedServices = persisted.services ?? [];

        const mergedServices = DEFAULT_SERVICES.map((defaultService) => {
          const saved = persistedServices.find((s) => s.id === defaultService.id);
          if (saved) {
            return {
              ...defaultService,
              enabled: saved.enabled,
              order: saved.order,
            };
          }
          return defaultService;
        });

        const customServices = persistedServices.filter((s) => s.id.startsWith('custom-'));
        const allServices = [...mergedServices, ...customServices];

        return {
          ...currentState,
          ...persisted,
          services: allServices,
        };
      },
    }
  )
);
