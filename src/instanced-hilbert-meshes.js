import * as three from 'three';
import HilbertGeometry from 'three-hilbert-geometry';

import { colorAlpha, colorStr2Hex } from './utils/color-utils.js';

const CHILD_PERMUTATIONS = [
  [0, 3, 4, 7, 6, 5, 2, 1],
  [0, 7, 6, 1, 2, 5, 4, 3],
  [0, 7, 6, 1, 2, 5, 4, 3],
  [2, 3, 0, 1, 6, 7, 4, 5],
  [2, 3, 0, 1, 6, 7, 4, 5],
  [4, 3, 2, 5, 6, 1, 0, 7],
  [4, 3, 2, 5, 6, 1, 0, 7],
  [6, 5, 2, 1, 0, 3, 4, 7]
];

const { orientations: HILBERT_ORIENTATIONS, transitions: HILBERT_ORIENTATION_TRANSITIONS } = createOrientationTables();

function createOrientationTables() {
  const orientations = [[0, 1, 2, 3, 4, 5, 6, 7]];
  const transitions = [];
  const orientationIds = new Map([[orientations[0].join(''), 0]]);
  for (let i = 0; i < orientations.length; i++) {
    const orientation = orientations[i];
    const childTransitions = [];
    for (const permutation of CHILD_PERMUTATIONS) {
      const childOrientation = permutation.map(index => orientation[index]);
      const key = childOrientation.join('');
      let id = orientationIds.get(key);
      if (id === undefined) {
        id = orientations.length;
        orientations.push(childOrientation);
        orientationIds.set(key, id);
      }
      childTransitions.push(id);
    }
    transitions.push(childTransitions);
  }
  return { orientations, transitions };
}

function createInstancedHilbertMeshes({
  useInstancing = true,
  data,
  order,
  paddingAccessor,
  colorAccessor,
  labelAccessor,
  defaultColorScale,
  simplifyCurves,
  SCALE
}) {
  const instanceMaterialCache = new Map();
  const geometryCache = new Map();
  const geometries = new WeakMap();
  const fallbackData = [];
  const batches = new Map();
  const usedGeometryKeys = new Set();

  data.forEach(d => {
    const padding = paddingAccessor(d);
    if (!useInstancing) {
      geometries.set(d, createGeometry(order, d, padding, simplifyCurves));
      fallbackData.push(d);
      return;
    }

    const description = getSimpleHilbertGeometry(order, d.start, d.length, padding, simplifyCurves);
    if (!description) {
      geometries.set(d, createGeometry(order, d, padding, simplifyCurves));
      fallbackData.push(d);
      return;
    }

    const color = colorAccessor?.(d) || defaultColorScale(labelAccessor(d) || '');
    const { points, width, scale } = description;
    const key = getCurvePath(points);
    const geometryKey = `${key}|${width / scale}`;
    usedGeometryKeys.add(geometryKey);

    let templateGeometry = geometryCache.get(geometryKey);
    if (!templateGeometry) {
      const geometry = createGeometry(order, d, padding, simplifyCurves);
      templateGeometry = createTemplateGeometry(geometry, points[0], scale);
      geometryCache.set(geometryKey, templateGeometry);
      geometry.dispose();
    }

    let material = instanceMaterialCache.get(color);
    if (!material) {
      const opacity = colorAlpha(color);
      material = new three.MeshLambertMaterial();
      material.color.set(colorStr2Hex(color));
      material.transparent = opacity < 1;
      material.opacity = opacity;
      instanceMaterialCache.set(color, material);
    }

    let colorBatches = batches.get(geometryKey);
    if (!colorBatches) {
      colorBatches = new Map();
      batches.set(geometryKey, colorBatches);
    }

    let batch = colorBatches.get(color);
    if (!batch) {
      batch = {
        geometry: templateGeometry,
        material,
        transforms: new Float32Array(256),
        count: 0,
        data: []
      };
      colorBatches.set(color, batch);
    }

    const instanceScale = scale * SCALE;
    let transforms = batch.transforms;
    if (batch.count * 4 === transforms.length) {
      const expandedTransforms = new Float32Array(transforms.length * 2);
      expandedTransforms.set(transforms);
      transforms = batch.transforms = expandedTransforms;
    }
    const transformOffset = batch.count * 4;
    transforms[transformOffset] = instanceScale;
    transforms[transformOffset + 1] = points[0].x * SCALE;
    transforms[transformOffset + 2] = points[0].y * SCALE;
    transforms[transformOffset + 3] = points[0].z * SCALE;
    batch.count++;
    batch.data.push(d);
  });

  geometryCache.forEach((geometry, key) => {
    if (!usedGeometryKeys.has(key)) {
      geometry.dispose();
      geometryCache.delete(key);
    }
  });

  const meshes = [];
  batches.forEach(colorBatches => {
    colorBatches.forEach(batch => {
      const mesh = new three.InstancedMesh(batch.geometry, batch.material, batch.count);
      const matrices = mesh.instanceMatrix.array;
      for (let i = 0; i < batch.count; i++) {
        const transformOffset = i * 4;
        const matrixOffset = i * 16;
        const scale = batch.transforms[transformOffset];
        matrices[matrixOffset] = scale;
        matrices[matrixOffset + 5] = scale;
        matrices[matrixOffset + 10] = scale;
        matrices[matrixOffset + 12] = batch.transforms[transformOffset + 1];
        matrices[matrixOffset + 13] = batch.transforms[transformOffset + 2];
        matrices[matrixOffset + 14] = batch.transforms[transformOffset + 3];
        matrices[matrixOffset + 15] = 1;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.data = batch.data;
      meshes.push(mesh);
    });
  });

  return {
    fallbackData,
    geometries,
    meshes
  };
}

function createGeometry(order, datum, padding, simplifyCurves) {
  return new HilbertGeometry(order, datum.start, datum.length, { padding, simplifyCurves });
}

function createTemplateGeometry(geometry, origin, scale) {
  const templateGeometry = new three.BufferGeometry();
  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    templateGeometry.setAttribute(name, attribute.clone());
  });
  if (geometry.index) templateGeometry.setIndex(geometry.index.clone());
  geometry.groups.forEach(group => templateGeometry.addGroup(group.start, group.count, group.materialIndex));
  templateGeometry.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
  const positions = templateGeometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(
      i,
      (positions.getX(i) - origin.x) / scale,
      (positions.getY(i) - origin.y) / scale,
      (positions.getZ(i) - origin.z) / scale
    );
  }
  positions.needsUpdate = true;
  templateGeometry.computeBoundingBox();
  templateGeometry.computeBoundingSphere();
  return templateGeometry;
}

function getSimpleHilbertGeometry(order, start, length, padding, simplifyCurves) {
  const isBigInt = typeof start === 'bigint' && typeof length === 'bigint';
  if (!Number.isInteger(order) || (typeof start === 'bigint') !== (typeof length === 'bigint')) return null;
  if (!isBigInt && (!Number.isFinite(start) || !Number.isFinite(length))) return null;

  let pointOrder = order;
  let first = isBigInt ? start : Math.round(start);
  let pointCount = isBigInt ? length : Math.round(length);
  const unit = isBigInt ? 8n : 8;
  const zero = isBigInt ? 0n : 0;
  if (simplifyCurves) {
    while (pointOrder > 0 && first % unit === zero && pointCount % unit === zero) {
      first /= unit;
      pointCount /= unit;
      pointOrder--;
    }
  }

  const cellSize = 1 / 2 ** (pointOrder - 1);
  const width = cellSize * (1 - Math.min(1, padding));
  if (!(width > 0) || !Number.isFinite(width)) return null;

  if (pointOrder <= 0) {
    const points = [{ x: 0, y: 0, z: 0 }];
    return { points, width, scale: width };
  }

  let rangeStart;
  let rangeEnd;
  if (isBigInt) {
    const curveLength = 8n ** BigInt(pointOrder);
    rangeStart = first < 0n ? 0n : first;
    rangeEnd = rangeStart + (pointCount > 0n ? pointCount : 0n);
    if (rangeEnd > curveLength) rangeEnd = curveLength;
    if (rangeStart >= rangeEnd || rangeEnd - rangeStart > 4n) return null;
  } else {
    const curveLength = 8 ** pointOrder;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(pointCount) || !Number.isFinite(curveLength)) return null;
    rangeStart = Math.max(0, first);
    rangeEnd = Math.min(curveLength, rangeStart + Math.max(0, pointCount));
    if (rangeStart >= rangeEnd || rangeEnd - rangeStart > 4) return null;
  }

  const points = [];
  for (let index = rangeStart; index < rangeEnd; index = isBigInt ? index + 1n : index + 1) {
    points.push(getHilbertPoint(index, pointOrder));
  }

  const scale = points.length === 1
    ? width
    : Math.abs(points[1].x - points[0].x) + Math.abs(points[1].y - points[0].y) + Math.abs(points[1].z - points[0].z);
  return { points, width, scale };
}

function getHilbertPoint(index, order) {
  const isBigInt = typeof index === 'bigint';
  let divisor = isBigInt ? 8n ** BigInt(order - 1) : 8 ** (order - 1);
  let x = 0;
  let y = 0;
  let z = 0;
  let size = 1;
  let orientation = 0;
  for (let i = 0; i < order; i++) {
    const digit = isBigInt
      ? Number(index / divisor % 8n)
      : Math.floor(index / divisor) % 8;
    const corner = HILBERT_ORIENTATIONS[orientation][digit];
    const half = size / 2;
    x += corner < 4 ? -half : half;
    y += corner < 2 || corner > 5 ? half : -half;
    z += corner % 4 === 1 || corner % 4 === 2 ? half : -half;
    size = half;
    orientation = HILBERT_ORIENTATION_TRANSITIONS[orientation][digit];
    divisor = isBigInt ? divisor / 8n : divisor / 8;
  }

  return { x, y, z };
}

function getCurvePath(points) {
  const path = [];
  let prevPnt = points[0];

  for (let i = 1; i < points.length; i++) {
    const pnt = points[i];
    for (const c of ['x', 'y', 'z']) {
      const dist = pnt[c] - prevPnt[c];
      if (dist) {
        path.push(
          c === 'x' ? dist > 0 ? 'R' : 'L'
            : c === 'y' ? dist > 0 ? 'U' : 'D'
              : dist > 0 ? 'B' : 'F'
        );
        break;
      }
    }
    prevPnt = pnt;
  }
  return path.join('');
}

export default createInstancedHilbertMeshes;
