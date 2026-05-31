/**
 * Card style system types.
 * Each card style defines how the share/export image is rendered on canvas.
 */

/** Rendering context passed to every card style renderer */
export interface CardRenderContext {
  /** The 2D canvas element (for createImage, etc.) */
  canvas: any
  /** The 2D rendering context */
  ctx: CanvasRenderingContext2D
  /** Canvas pixel width */
  width: number
  /** Canvas pixel height */
  height: number
}

/** Options passed to the render function */
export interface CardRenderOptions {
  /** Temp file path of the board grid image (transparent background) */
  boardImagePath: string
  /** Board title text */
  title: string
  /** Watermark text */
  watermark: string
  /** Board ID for display (user's Nth board) */
  boardId?: number
  /** Theme colors from current color theme */
  colors: {
    bg: string
    cellBg: string
    textColor: string
    borderColor: string
    accentColor: string
  }
}

/** A card style definition */
export interface CardStyleDefinition {
  /** Unique identifier */
  id: string
  /** Display name (Chinese) */
  name: string
  /** Icon/emoji for picker */
  icon: string
  /** Short description */
  description: string
  /** Canvas dimensions */
  canvasWidth: number
  canvasHeight: number
  /** Render the card onto the canvas, return temp file path */
  render: (rctx: CardRenderContext, opts: CardRenderOptions) => Promise<void>
}
