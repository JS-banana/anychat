import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ChatService, DEFAULT_SERVICES } from '@/types';

interface AppState {
  services: ChatService[];
  activeServiceId: string | null;
  settingsOpen: boolean;
  addServiceDialogOpen: boolean;
  chatHistoryOpen: boolean;
  
  setActiveService: (id: string) => void;
  addService: (service: Omit<ChatService, 'id' | 'order'>) => void;
  removeService: (id: string) => void;
  updateService: (id: string, updates: Partial<ChatService>) => void;
  toggleServiceEnabled: (id: string) => void;
  reorderServices: (startIndex: number, endIndex: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setAddServiceDialogOpen: (open: boolean) => void;
  setChatHistoryOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      services: DEFAULT_SERVICES,
      activeServiceId: DEFAULT_SERVICES.find(s => s.enabled)?.id ?? null,
      settingsOpen: false,
      addServiceDialogOpen: false,
      chatHistoryOpen: false,

      setActiveService: (id) => {
        const service = get().services.find(s => s.id === id);
        if (service?.enabled) {
          set({ activeServiceId: id });
        }
      },

      addService: (serviceData) => {
        const services = get().services;
        const id = `custom-${Date.now()}`;
        const order = Math.max(...services.map(s => s.order), -1) + 1;
        const newService: ChatService = {
          ...serviceData,
          id,
          order,
          enabled: true,
        };
        set({ services: [...services, newService] });
      },

      removeService: (id) => {
        const services = get().services.filter(s => s.id !== id);
        const activeId = get().activeServiceId;
        set({
          services,
          activeServiceId: activeId === id 
            ? services.find(s => s.enabled)?.id ?? null 
            : activeId,
        });
      },

      updateService: (id, updates) => {
        set({
          services: get().services.map(s =>
            s.id === id ? { ...s, ...updates } : s
          ),
        });
      },

      toggleServiceEnabled: (id) => {
        const services = get().services.map(s =>
          s.id === id ? { ...s, enabled: !s.enabled } : s
        );
        const activeId = get().activeServiceId;
        const targetService = services.find(s => s.id === id);
        
        let newActiveId = activeId;
        if (activeId === id && !targetService?.enabled) {
          newActiveId = services.find(s => s.enabled)?.id ?? null;
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

      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setAddServiceDialogOpen: (open) => set({ addServiceDialogOpen: open }),
      setChatHistoryOpen: (open) => set({ chatHistoryOpen: open }),
    }),
    {
      name: 'chat-box-app-storage',
      partialize: (state) => ({
        services: state.services,
        activeServiceId: state.activeServiceId,
      }),
    }
  )
);
