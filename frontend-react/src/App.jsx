import React from 'react'
import LivingCanvas from './canvas/LivingCanvas'

export default function App() {
  return (
    // The bg-surface-base ensures that if the canvas fails to load, 
    // the user still sees the correct theme background color.
    // overflow-hidden prevents any accidental scrolling during the test.
    <main className="relative w-full h-dvh overflow-hidden bg-surface-base">
      
      {/* Forcing the state to 'idle' and role to 'a' to test the engine. 
        Note: Because your sessionStore stub returns `null`, LivingCanvas 
        will automatically fall back to DEFAULT_PAINTING_PARAMS. 
        
        To see your new `gentle` painting in action during this test, 
        temporarily change your export in `src/paintings/index.js` to:
        export const DEFAULT_PAINTING_PARAMS = gentle
      */}
      <LivingCanvas role="a" overrideCanvasState="idle" />
      
    </main>
  )
}