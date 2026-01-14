import { useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';

export function useKeyboardShortcuts() {
  const { services, setActiveService } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const enabledServices = services.filter((s) => s.enabled).sort((a, b) => a.order - b.order);

      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const targetService = enabledServices[num - 1];
        if (targetService) {
          setActiveService(targetService.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [services, setActiveService]);
}
