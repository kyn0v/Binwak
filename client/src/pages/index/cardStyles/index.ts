/**
 * Card style registry.
 * Exports all available card styles and a composable for managing selection.
 */
import { ref } from 'vue'
import type { CardStyleDefinition } from './types'
import { polaroidStyle } from './polaroid'

/** All registered card styles in display order */
export const cardStyles: CardStyleDefinition[] = [
  polaroidStyle,
]

/** Composable for managing the active card style */
export function useCardStyle() {
  const currentCardStyleId = ref<string>('polaroid')

  function getCardStyle(): CardStyleDefinition {
    return cardStyles.find((s) => s.id === currentCardStyleId.value) ?? polaroidStyle
  }

  function setCardStyle(id: string) {
    const found = cardStyles.find((s) => s.id === id)
    if (found) {
      currentCardStyleId.value = id
    }
  }

  return {
    currentCardStyleId,
    cardStyles,
    getCardStyle,
    setCardStyle,
  }
}

export type { CardStyleDefinition, CardRenderContext, CardRenderOptions } from './types'
