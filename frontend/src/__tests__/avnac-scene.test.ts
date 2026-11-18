import { describe, expect, it } from 'vitest'
import {
  distributeGroupChildrenEvenly,
  getAvnacDocumentStorageKind,
  curveFromHandle,
  curveHandlePoint,
  getGroupChildSpacing,
  lineGeometry,
  linePathD,
  parseAvnacDocument,
  type SceneGroup,
  type SceneObject,
  setGroupChildSpacing,
} from '../lib/avnac-scene'

const solidBlack = { type: 'solid' as const, color: '#000000' }
const transparent = { type: 'solid' as const, color: 'transparent' }

function rect(id: string, x: number, y: number, width: number, height: number): SceneObject {
  return {
    id,
    type: 'rect',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    fill: solidBlack,
    stroke: transparent,
    strokeWidth: 0,
    cornerRadius: 0,
  }
}

function group(children: SceneObject[]): SceneGroup {
  return {
    id: 'group',
    type: 'group',
    x: 100,
    y: 80,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    children,
  }
}

describe('parseAvnacDocument', () => {
  it('detects current vs legacy stored document formats', () => {
    expect(
      getAvnacDocumentStorageKind({
        v: 2,
        artboard: { width: 1200, height: 900 },
        bg: { type: 'solid', color: '#ffffff' },
        objects: [],
      }),
    ).toBe('current')

    expect(
      getAvnacDocumentStorageKind({
        v: 1,
        artboard: { width: 1200, height: 900 },
        bg: { type: 'solid', color: '#ffffff' },
        fabric: { objects: [] },
      }),
    ).toBe('legacy')

    expect(getAvnacDocumentStorageKind({ v: 99 })).toBe('invalid')
  })

  it('migrates legacy Fabric-based v1 documents into the scene format', () => {
    const legacy = {
      v: 1,
      artboard: { width: 1200, height: 900 },
      bg: { type: 'solid', color: '#ffffff' },
      fabric: {
        objects: [
          {
            type: 'circle',
            left: 220,
            top: 180,
            originX: 'left',
            originY: 'top',
            width: 220,
            height: 220,
            scaleX: 1,
            scaleY: 1,
            fill: '#262626',
            stroke: 'transparent',
            strokeWidth: 0,
            angle: 0,
            opacity: 1,
            visible: true,
            avnacLayerId: 'legacy-circle',
          },
          {
            type: 'textbox',
            left: 420,
            top: 300,
            originX: 'left',
            originY: 'top',
            width: 420,
            height: 120,
            scaleX: 1,
            scaleY: 1,
            fill: '#171717',
            stroke: 'transparent',
            strokeWidth: 0,
            angle: -26,
            opacity: 1,
            visible: true,
            text: 'Legacy fabric text',
            fontFamily: 'Inter',
            fontSize: 96,
            textAlign: 'left',
            avnacLayerId: 'legacy-text',
          },
        ],
      },
    }

    const document = parseAvnacDocument(legacy)

    expect(document).not.toBeNull()
    expect(document).toMatchObject({
      v: 2,
      artboard: { width: 1200, height: 900 },
      objects: [
        {
          id: 'legacy-circle',
          type: 'ellipse',
          x: 220,
          y: 180,
          width: 220,
          height: 220,
        },
        {
          id: 'legacy-text',
          type: 'text',
          x: 420,
          y: 300,
          width: 420,
          height: 120,
          rotation: -26,
          text: 'Legacy fabric text',
          fontFamily: 'Inter',
          fontSize: 96,
        },
      ],
    })
  })

  it('accepts Fabric 6 capitalized legacy object types', () => {
    const legacy = {
      v: 1,
      artboard: { width: 1080, height: 1350 },
      bg: { type: 'solid', color: '#ffffff' },
      fabric: {
        objects: [
          {
            type: 'Image',
            left: 946.341,
            top: 1201,
            width: 512,
            height: 512,
            scaleX: 0.2754,
            scaleY: 0.2754,
            originX: 'center',
            originY: 'center',
            src: 'data:image/png;base64,abc',
            avnacLayerId: 'legacy-qr',
          },
          {
            type: 'Rect',
            left: 13.86,
            top: 10.8456,
            width: 216,
            height: 162,
            scaleX: 4.74,
            scaleY: 7.9066,
            originX: 'left',
            originY: 'top',
            fill: 'transparent',
            stroke: '#fcc419',
            strokeWidth: 6,
            avnacShape: { kind: 'rect' },
            avnacLayerId: 'legacy-frame',
          },
          {
            type: 'Textbox',
            left: 546.4596,
            top: 673,
            width: 147.9595,
            height: 161.3188,
            scaleX: 5.2555,
            scaleY: 5.2555,
            originX: 'center',
            originY: 'center',
            fill: '#fcc419',
            stroke: '#fcc419',
            strokeWidth: 0,
            text: 'HELLO\nFROM\nHERE',
            fontFamily: 'Aclonica',
            fontSize: 43,
            fontWeight: '700',
            lineHeight: 1.16,
            avnacLayerId: 'legacy-text',
          },
        ],
      },
    }

    const document = parseAvnacDocument(legacy)

    expect(document).not.toBeNull()
    expect(document?.objects).toHaveLength(3)
    expect(document?.objects.map(obj => obj.type)).toEqual(['image', 'rect', 'text'])
    expect(document?.objects[0]).toMatchObject({
      id: 'legacy-qr',
      type: 'image',
      src: 'data:image/png;base64,abc',
    })
    expect(document?.objects[1]).toMatchObject({
      id: 'legacy-frame',
      type: 'rect',
    })
    expect(document?.objects[2]).toMatchObject({
      id: 'legacy-text',
      type: 'text',
      text: 'HELLO\nFROM\nHERE',
      fontFamily: 'Aclonica',
      fontWeight: 700,
      lineHeight: 1.16,
    })
    expect((document?.objects[1] as { strokeWidth?: number } | undefined)?.strokeWidth).toBeCloseTo(
      36.73,
      2,
    )
    expect((document?.objects[2] as { fontSize?: number } | undefined)?.fontSize).toBeCloseTo(
      225.9865,
      4,
    )
  })

  it('defaults missing letter spacing to zero and preserves stored values', () => {
    const document = parseAvnacDocument({
      v: 2,
      artboard: { width: 1200, height: 900 },
      bg: { type: 'solid', color: '#ffffff' },
      activePageId: '',
      pages: [],
      objects: [
        {
          id: 'text-default',
          type: 'text',
          x: 120,
          y: 140,
          width: 320,
          height: 120,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          blurPct: 0,
          shadow: null,
          text: 'Default spacing',
          fill: { type: 'solid', color: '#171717' },
          stroke: { type: 'solid', color: 'transparent' },
          strokeWidth: 0,
          fontFamily: 'Inter',
          fontSize: 64,
          lineHeight: 1.22,
          fontWeight: 'normal',
          fontStyle: 'normal',
          underline: false,
          textAlign: 'left',
        },
        {
          id: 'text-spaced',
          type: 'text',
          x: 180,
          y: 260,
          width: 320,
          height: 120,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          blurPct: 0,
          shadow: null,
          text: 'Stored spacing',
          fill: { type: 'solid', color: '#171717' },
          stroke: { type: 'solid', color: 'transparent' },
          strokeWidth: 0,
          fontFamily: 'Inter',
          fontSize: 64,
          letterSpacing: 18,
          lineHeight: 1.22,
          fontWeight: 'normal',
          fontStyle: 'normal',
          underline: false,
          textAlign: 'left',
        },
      ],
    })

    expect(document).not.toBeNull()
    expect((document?.objects[0] as { letterSpacing?: number } | undefined)?.letterSpacing).toBe(0)
    expect((document?.objects[1] as { letterSpacing?: number } | undefined)?.letterSpacing).toBe(18)
  })
})

describe('group child spacing', () => {
  it('reports uniform spacing and mixed spacing', () => {
    const even = group([
      rect('a', 0, 0, 10, 10),
      rect('b', 20, 0, 10, 10),
      rect('c', 40, 0, 10, 10),
    ])
    const mixed = group([
      rect('a', 0, 0, 10, 10),
      rect('b', 20, 0, 10, 10),
      rect('c', 48, 0, 10, 10),
    ])

    expect(getGroupChildSpacing(even, 'horizontal')).toBe(10)
    expect(getGroupChildSpacing(mixed, 'horizontal')).toBeNull()
  })

  it('distributes children evenly while preserving the outer items', () => {
    const next = distributeGroupChildrenEvenly(
      group([rect('a', 0, 0, 10, 10), rect('b', 30, 0, 10, 10), rect('c', 100, 0, 20, 10)]),
      'horizontal',
    )

    expect(next.children.map(child => child.id)).toEqual(['a', 'b', 'c'])
    expect(next.children[0].x).toBe(0)
    expect(next.children[1].x).toBe(50)
    expect(next.children[2].x).toBe(100)
    expect(getGroupChildSpacing(next, 'horizontal')).toBe(40)
  })

  it('sets an exact vertical gap and resizes the group bounds', () => {
    const next = setGroupChildSpacing(
      group([rect('a', 0, 0, 10, 10), rect('b', 4, 26, 10, 20), rect('c', 8, 72, 10, 5)]),
      'vertical',
      12,
    )

    expect(next.children.map(child => child.y)).toEqual([0, 22, 54])
    expect(next.height).toBe(59)
    expect(getGroupChildSpacing(next, 'vertical')).toBe(12)
  })
})

describe('curved lines', () => {
  const savedLine = {
    id: 'l1',
    type: 'line',
    x: 0,
    y: 0,
    width: 200,
    height: 50,
    stroke: solidBlack,
    strokeWidth: 4,
    lineStyle: 'solid',
    roundedEnds: true,
  }
  const docWith = (line: object) =>
    parseAvnacDocument({
      v: 2,
      artboard: { width: 400, height: 400 },
      bg: solidBlack,
      objects: [line],
    })

  it('lines saved before curves existed load straight, with a default bend ready', () => {
    const line = docWith(savedLine)?.objects[0]
    expect(line).toMatchObject({ type: 'line', pathType: 'straight', curveBulge: 20, curveT: 0.5 })
  })

  it('a curved line keeps its curve and draws a quadratic path', () => {
    const line = docWith({ ...savedLine, pathType: 'curved', curveBulge: 10 })?.objects[0]
    if (line?.type !== 'line') throw new Error('expected a line')
    expect(line.pathType).toBe('curved')
    expect(lineGeometry(line).control).toEqual({ x: 100, y: 15 })
    expect(linePathD(line)).toBe('M 2 25 Q 100 15 198 25')
    expect(linePathD({ ...line, pathType: 'straight' })).toBe('M 2 25 L 198 25')
  })

  it('the bend handle sits on the curve and dragging it reshapes the curve under the pointer', () => {
    const line = docWith({ ...savedLine, pathType: 'curved', curveBulge: 10 })?.objects[0]
    if (line?.type !== 'line') throw new Error('expected a line')
    // Halfway along the curve: half the bulge above the line.
    expect(curveHandlePoint(line)).toEqual({ x: 100, y: 20 })
    expect(curveFromHandle(line, curveHandlePoint(line))).toEqual({ curveBulge: 10, curveT: 0.5 })

    const higher = { ...line, ...curveFromHandle(line, { x: 80, y: -15 }) }
    expect(higher.curveBulge).toBe(80)
    expect(curveHandlePoint(higher).x).toBeCloseTo(80)
    expect(curveHandlePoint(higher).y).toBeCloseTo(-15)

    expect(curveFromHandle(line, { x: 100, y: 45 }).curveBulge).toBe(-40)
    expect(curveFromHandle(line, { x: 1000, y: 0 }).curveT).toBe(0.9)
    expect(curveFromHandle(line, { x: -1000, y: 0 }).curveT).toBe(0.1)
  })

  it('arrows bend the same way, along the shaft', () => {
    const arrow = parseAvnacDocument({
      v: 2,
      artboard: { width: 400, height: 400 },
      bg: solidBlack,
      objects: [
        {
          ...savedLine,
          type: 'arrow',
          headSize: 1,
          pathType: 'curved',
          curveBulge: 12,
          curveT: 0.3,
        },
      ],
    })?.objects[0]
    if (arrow?.type !== 'arrow') throw new Error('expected an arrow')
    const round = curveFromHandle(arrow, curveHandlePoint(arrow))
    expect(round.curveBulge).toBe(12)
    expect(round.curveT).toBeCloseTo(0.3)
  })
})
