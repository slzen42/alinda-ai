import React, { useEffect, useState } from 'react'
import LivingCanvas from './canvas/LivingCanvas'

export default function App() {
  // Debugger: Read the actual canvas pixel color at the center of the screen
  useEffect(() => {
    const id = setInterval(() => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) // Added to suppress browser warnings
      if (!ctx) return
      
      const w = canvas.width, h = canvas.height
      const pixel = ctx.getImageData(w / 2, h / 2, 1, 1).data
      
      console.log(`[Canvas Center Pixel] rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`)
    }, 3000)
    
    return () => clearInterval(id)
  }, [])

  return (
    <main className="relative w-full h-dvh overflow-hidden bg-surface-base">
      <LivingCanvas role="a" overrideCanvasState="idle" />
    </main>
  )
}