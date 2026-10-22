import { bindTranslations } from '../i18n.ts';
import { toast } from './dom.ts';
export async function getScene(container: HTMLElement) {
  try {
    const { GameScene } = await import('../scene.ts');
    const s = new GameScene(container, toast);
    await s.ready;
    return s;
  } catch (error) {
    container.innerHTML =
      '<div class="webgl-error"><b>Nie udało się uruchomić grafiki 3D.</b><p>Włącz akcelerację sprzętową i odśwież stronę w aktualnej przeglądarce.</p></div>';
    bindTranslations(container);
    throw error;
  }
}
