import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/app-store';
import { DEFAULT_SERVICES } from '@/types';

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      services: [...DEFAULT_SERVICES],
      activeServiceId: DEFAULT_SERVICES.find((s) => s.enabled)?.id ?? null,
      settingsOpen: false,
      addServiceDialogOpen: false,
      chatHistoryOpen: false,
    });
  });

  describe('setActiveService', () => {
    it('should set active service when service is enabled', () => {
      const { setActiveService } = useAppStore.getState();
      const enabledService = DEFAULT_SERVICES.find((s) => s.enabled);

      setActiveService(enabledService!.id);
      expect(useAppStore.getState().activeServiceId).toBe(enabledService!.id);
    });

    it('should not set active service when service is disabled', () => {
      const { setActiveService } = useAppStore.getState();
      const disabledService = DEFAULT_SERVICES.find((s) => !s.enabled);
      const initialActiveId = useAppStore.getState().activeServiceId;

      setActiveService(disabledService!.id);
      expect(useAppStore.getState().activeServiceId).toBe(initialActiveId);
    });
  });

  describe('addService', () => {
    it('should add new custom service', () => {
      const { addService } = useAppStore.getState();
      const initialCount = useAppStore.getState().services.length;

      addService({
        name: 'Test AI',
        url: 'https://test.ai',
        enabled: true,
      });

      const services = useAppStore.getState().services;
      expect(services.length).toBe(initialCount + 1);
      expect(services[services.length - 1].name).toBe('Test AI');
    });

    it('should assign correct order to new service', () => {
      const { addService } = useAppStore.getState();
      const maxOrder = Math.max(...useAppStore.getState().services.map((s) => s.order));

      addService({
        name: 'Test AI',
        url: 'https://test.ai',
        enabled: true,
      });

      const newService =
        useAppStore.getState().services[useAppStore.getState().services.length - 1];
      expect(newService.order).toBe(maxOrder + 1);
    });

    it('should generate custom id for new service', () => {
      const { addService } = useAppStore.getState();

      addService({
        name: 'Test AI',
        url: 'https://test.ai',
        enabled: true,
      });

      const newService =
        useAppStore.getState().services[useAppStore.getState().services.length - 1];
      expect(newService.id).toMatch(/^custom-/);
    });
  });

  describe('removeService', () => {
    it('should remove service by id', () => {
      const { removeService } = useAppStore.getState();
      const serviceToRemove = DEFAULT_SERVICES[0];
      const initialCount = useAppStore.getState().services.length;

      removeService(serviceToRemove.id);

      expect(useAppStore.getState().services.length).toBe(initialCount - 1);
      expect(
        useAppStore.getState().services.find((s) => s.id === serviceToRemove.id)
      ).toBeUndefined();
    });

    it('should switch active service when removing active service', () => {
      const { removeService, setActiveService } = useAppStore.getState();
      const enabledServices = DEFAULT_SERVICES.filter((s) => s.enabled);

      if (enabledServices.length >= 2) {
        setActiveService(enabledServices[0].id);
        removeService(enabledServices[0].id);

        expect(useAppStore.getState().activeServiceId).not.toBe(enabledServices[0].id);
      }
    });
  });

  describe('toggleServiceEnabled', () => {
    it('should toggle service enabled state', () => {
      const { toggleServiceEnabled } = useAppStore.getState();
      const service = DEFAULT_SERVICES[0];
      const initialEnabled = service.enabled;

      toggleServiceEnabled(service.id);

      const updatedService = useAppStore.getState().services.find((s) => s.id === service.id);
      expect(updatedService?.enabled).toBe(!initialEnabled);
    });

    it('should switch active when disabling active service', () => {
      const { toggleServiceEnabled, setActiveService } = useAppStore.getState();
      const enabledServices = DEFAULT_SERVICES.filter((s) => s.enabled);

      if (enabledServices.length >= 2) {
        setActiveService(enabledServices[0].id);
        toggleServiceEnabled(enabledServices[0].id);

        expect(useAppStore.getState().activeServiceId).not.toBe(enabledServices[0].id);
      }
    });
  });

  describe('reorderServices', () => {
    it('should reorder services correctly', () => {
      const { reorderServices } = useAppStore.getState();
      const services = useAppStore.getState().services;
      const firstId = services[0].id;
      const secondId = services[1].id;

      reorderServices(0, 1);

      const reorderedServices = useAppStore.getState().services;
      expect(reorderedServices[0].id).toBe(secondId);
      expect(reorderedServices[1].id).toBe(firstId);
    });

    it('should update order property after reorder', () => {
      const { reorderServices } = useAppStore.getState();

      reorderServices(0, 2);

      const services = useAppStore.getState().services;
      services.forEach((service, index) => {
        expect(service.order).toBe(index);
      });
    });
  });

  describe('dialog states', () => {
    it('should toggle settings dialog', () => {
      const { setSettingsOpen } = useAppStore.getState();

      setSettingsOpen(true);
      expect(useAppStore.getState().settingsOpen).toBe(true);

      setSettingsOpen(false);
      expect(useAppStore.getState().settingsOpen).toBe(false);
    });

    it('should toggle add service dialog', () => {
      const { setAddServiceDialogOpen } = useAppStore.getState();

      setAddServiceDialogOpen(true);
      expect(useAppStore.getState().addServiceDialogOpen).toBe(true);

      setAddServiceDialogOpen(false);
      expect(useAppStore.getState().addServiceDialogOpen).toBe(false);
    });

    it('should toggle chat history panel', () => {
      const { setChatHistoryOpen } = useAppStore.getState();

      setChatHistoryOpen(true);
      expect(useAppStore.getState().chatHistoryOpen).toBe(true);

      setChatHistoryOpen(false);
      expect(useAppStore.getState().chatHistoryOpen).toBe(false);
    });
  });
});
