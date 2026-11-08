import { useMemo, useRef, useState } from "react"

/** Tracks an element's content width. Returns 0 until the element mounts. */
export function useElementWidth<T extends HTMLElement>(): [React.RefCallback<T>, number] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useMemo<React.RefCallback<T>>(
    () => (node) => {
      observer.current?.disconnect()
      if (!node) return
      setWidth(Math.floor(node.getBoundingClientRect().width))
      observer.current = new ResizeObserver(([entry]) => {
        if (entry) setWidth(Math.floor(entry.contentRect.width))
      })
      observer.current.observe(node)
    },
    [],
  )
  return [ref, width]
}
