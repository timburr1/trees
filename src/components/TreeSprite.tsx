import type { GrowthStage } from '../lib/growth-stage.ts';
import type { Species } from '../lib/species-catalog.ts';
import { treeGeometry, treeViewBox, type TreeShape } from '../lib/tree-geometry.ts';
import { treeLabel } from '../lib/tree-label.ts';

function ShapeView({ shape }: { shape: TreeShape }) {
  switch (shape.kind) {
    case 'rect':
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.fill} />;
    case 'ellipse':
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={shape.fill} />;
    case 'polygon':
      return <polygon points={shape.points.map(([x, y]) => `${x},${y}`).join(' ')} fill={shape.fill} />;
    default:
      throw new Error(`Unhandled shape: ${JSON.stringify(shape satisfies never)}`);
  }
}

/** Fills its container, so the caller sets the size. `decorative` hides it from assistive technology, for places that carry their own label. */
export function TreeSprite({ species, stage, dead, decorative }: { species: Species; stage: GrowthStage; dead: boolean; decorative: boolean }) {
  const shapes = treeGeometry(species, stage, dead);
  return (
    <svg
      viewBox={`0 0 ${treeViewBox.width} ${treeViewBox.height}`}
      width="100%"
      height="100%"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': treeLabel(species, stage, dead) })}
    >
      {shapes.map((shape, index) => (
        <ShapeView key={index} shape={shape} />
      ))}
    </svg>
  );
}
