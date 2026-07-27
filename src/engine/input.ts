/** Keyboard + mouse, reported in the game's internal pixel coordinates. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mouseClicked = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private toInternal: (clientX: number, clientY: number) => { x: number; y: number },
  ) {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!this.down.has(k)) this.pressedThisFrame.add(k);
      this.down.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.down.clear());

    this.canvas.addEventListener('mousemove', (e) => {
      const p = this.toInternal(e.clientX, e.clientY);
      this.mouseX = p.x;
      this.mouseY = p.y;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.mouseDown = true;
      this.mouseClicked = true;
    });
    window.addEventListener('mouseup', () => (this.mouseDown = false));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(...keys: string[]): boolean {
    return keys.some((k) => this.down.has(k));
  }

  pressed(...keys: string[]): boolean {
    return keys.some((k) => this.pressedThisFrame.has(k));
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mouseClicked = false;
  }
}
