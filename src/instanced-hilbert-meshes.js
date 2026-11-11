import * as three from 'three';
import HilbertGeometry from 'three-hilbert-geometry';

import { MAX_LABEL_FONT_SIZE } from './utils/label-atlas';
const MAX_CUBE_LABEL_FONT_SIZE = 0.5;

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

function createHilbertGeometries({
  useInstancing = true,
  data,
  order,
  paddingAccessor,
  paddingAbsoluteAccessor,
  simplifyCurves
}) {
  const geometryCache = new Map();
  const fallbackGeometries = new Map();
  const batches = new Map();

  data.forEach(d => {
    const padding = paddingAccessor(d);
    const paddingAbsolute = paddingAbsoluteAccessor(d);

    const description = useInstancing && getSimpleHilbertGeometry(order, d.start, d.length, padding, paddingAbsolute, simplifyCurves);

    if (!useInstancing || !description) { // skip instancing
      fallbackGeometries.set(d, createGeometry(order, d, padding, paddingAbsolute, simplifyCurves));
      return;
    }

    const { points, width, scale } = description;
    const key = getCurvePath(points);
    const geometryKey = `${key}|${width / scale}`;

    let geometry = geometryCache.get(geometryKey);
    if (!geometry) {
      geometry = createGeometry(order, d, padding, paddingAbsolute, simplifyCurves);
      geometryCache.set(geometryKey, geometry);
    }

    let batch = batches.get(geometryKey);
    if (!batch) {
      batch = {
        geometry,
        origin: points[0],
        scale,
        instances: []
      };
      batches.set(geometryKey, batch);
    }
    batch.instances.push({ data: d, position: points[0], scale });
  });

  const instancedGeometries = Array.from(batches.values());
  instancedGeometries.forEach(batch => {
    const sourceGeometry = batch.geometry;
    batch.geometry = createTemplateGeometry(sourceGeometry, batch.origin, batch.scale);
    sourceGeometry.dispose();
    delete batch.origin;
    delete batch.scale;
  });

  return { instancedGeometries, fallbackGeometries };
}

function createGeometry(order, datum, padding, paddingAbsolute, simplifyCurves) {
  const geometry = new HilbertGeometry(order, datum.start, datum.length, { padding, paddingAbsolute, simplifyCurves });
  mapLabelUVs(geometry);
  return geometry;
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
  if (geometry.parameters) {
    templateGeometry.parameters = {
      ...geometry.parameters,
      points: geometry.parameters.points?.map(point => point.clone().sub(origin).divideScalar(scale))
    };
  }
  return templateGeometry;
}

function getSimpleHilbertGeometry(order, start, length, padding, paddingAbsolute, simplifyCurves) {
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
  const width = (cellSize - Math.min(paddingAbsolute, cellSize * 0.5)) * (1 - Math.min(1, padding));
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

function mapLabelUVs(geometry) {
  const uvs = geometry.getAttribute('uv');
  if (!uvs) return;

  const positions = geometry.getAttribute('position');
  const points = geometry.parameters?.points;
  const labelAspects = new Float32Array(uvs.count);
  const labelMaxFontSizes = new Float32Array(uvs.count).fill(MAX_LABEL_FONT_SIZE);
  const labelReverse = new Float32Array(uvs.count);
  const uTurnInteriorFaces = getUTurnInteriorFaces(points, positions);
  const sideQuads = [];
  if (points?.length > 1) {
    const sideQuadCount = (points.length - 1) * 4;
    for (let vertex = 0; vertex + 3 < uvs.count && vertex / 4 < sideQuadCount; vertex += 4) {
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let corner = 0; corner < 4; corner++) {
        minU = Math.min(minU, uvs.getX(vertex + corner));
        maxU = Math.max(maxU, uvs.getX(vertex + corner));
        minV = Math.min(minV, uvs.getY(vertex + corner));
        maxV = Math.max(maxV, uvs.getY(vertex + corner));
      }
      if (maxU <= minU || maxV === minV) continue;
      sideQuads.push({ vertex, minU, maxU, minV, maxV });
    }
  } else {
    for (let vertex = 0; vertex + 3 < uvs.count; vertex += 4) {
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let corner = 0; corner < 4; corner++) {
        minU = Math.min(minU, uvs.getX(vertex + corner));
        maxU = Math.max(maxU, uvs.getX(vertex + corner));
        minV = Math.min(minV, uvs.getY(vertex + corner));
        maxV = Math.max(maxV, uvs.getY(vertex + corner));
      }
      if (Math.abs(maxU - minU - 0.25) > 0.01 || maxV <= minV) continue;
      sideQuads.push({ vertex, minU, maxU, minV, maxV });
    }
  }
  const sideQuadVertices = new Set(sideQuads.map(({ vertex }) => vertex));

  sideQuads.forEach(({ vertex, minU, maxU, minV, maxV }, index) => {
    for (let corner = 0; corner < 4; corner++) labelReverse[vertex + corner] = 1;
    if (uTurnInteriorFaces.has(vertex)) {
      for (let corner = 0; corner < 4; corner++) uvs.setX(vertex + corner, -1);
      return;
    }
    if (positions && !isRectangularFace(positions, vertex)) {
      for (let corner = 0; corner < 4; corner++) uvs.setX(vertex + corner, -1);
      return;
    }

    const pathSegment = Math.floor(index / 4);
    const startPoint = points?.[pathSegment];
    const endPoint = points?.[pathSegment + 1];
    const dx = endPoint ? endPoint.x - startPoint.x : 0;
    const dy = endPoint ? endPoint.y - startPoint.y : 0;
    const dz = endPoint ? endPoint.z - startPoint.z : 0;
    const segmentLength = Math.hypot(dx, dy, dz);
    const projectedDistances = Array.from({ length: 4 }, (_, corner) => {
      const positionIndex = vertex + corner;
      return positions && startPoint && segmentLength
        ? ((positions.getX(positionIndex) - startPoint.x) * dx
        + (positions.getY(positionIndex) - startPoint.y) * dy
        + (positions.getZ(positionIndex) - startPoint.z) * dz) / segmentLength
        : segmentLength * (uvs.getY(positionIndex) - minV) / (maxV - minV);
    });
    const minDistance = Math.min(...projectedDistances);
    const maxDistance = Math.max(...projectedDistances);
    const labelLength = maxDistance - minDistance;
    const sideWidth = positions
      ? new three.Vector3().fromBufferAttribute(positions, vertex).distanceTo(
        new three.Vector3().fromBufferAttribute(positions, vertex + 1)
      )
      : 0;
    if (sideWidth > 0) {
      for (let corner = 0; corner < 4; corner++) labelAspects[vertex + corner] = labelLength / sideWidth;
    }
    if (labelLength < 1e-6) {
      for (let corner = 0; corner < 4; corner++) uvs.setX(vertex + corner, -1);
      return;
    }

    for (let corner = 0; corner < 4; corner++) {
      const positionIndex = vertex + corner;
      const alongLabel = (projectedDistances[corner] - minDistance) / labelLength;
      const sidePosition = uvs.getX(positionIndex);
      uvs.setXY(positionIndex, 1 - alongLabel, 1 - (sidePosition - minU) / (maxU - minU));
    }
  });

  if (!sideQuads.length) {
    mapSingleCellSideUVs(geometry, uvs, labelAspects, labelMaxFontSizes);
  } else {
    for (let vertex = 0; vertex + 3 < uvs.count; vertex += 4) {
      if (sideQuadVertices.has(vertex)) continue;
      for (let corner = 0; corner < 4; corner++) {
        uvs.setX(vertex + corner, -1);
      }
    }
  }
  geometry.setAttribute('atlasLabelAspect', new three.Float32BufferAttribute(labelAspects, 1));
  geometry.setAttribute('atlasLabelMaxFontSize', new three.Float32BufferAttribute(labelMaxFontSizes, 1));
  geometry.setAttribute('atlasLabelReverse', new three.Float32BufferAttribute(labelReverse, 1));
  uvs.needsUpdate = true;

  //

  function getUTurnInteriorFaces(points, positions) {
    const hiddenFaces = new Set();
    if (!points || points.length < 4 || !positions) return hiddenFaces;

    const directions = points.slice(1).map((point, index) => point.clone().sub(points[index]).normalize());
    for (let middleSegment = 1; middleSegment < directions.length - 1; middleSegment++) {
      const incoming = directions[middleSegment - 1];
      const middle = directions[middleSegment];
      const outgoing = directions[middleSegment + 1];
      if (incoming.dot(outgoing) > -0.999999 || Math.abs(incoming.dot(middle)) > 1e-6) continue;

      const interiorNormals = [
        { segment: middleSegment - 1, normal: middle },
        { segment: middleSegment, normal: incoming.clone().negate() },
        { segment: middleSegment + 1, normal: middle }
      ];
      interiorNormals.forEach(({ segment, normal }) => {
        const pathCenter = points[segment].clone().add(points[segment + 1]).multiplyScalar(0.5);
        for (let side = 0; side < 4; side++) {
          const vertex = (segment * 4 + side) * 4;
          const faceCenter = new three.Vector3();
          for (let corner = 0; corner < 4; corner++) {
            faceCenter.add(new three.Vector3().fromBufferAttribute(positions, vertex + corner));
          }
          faceCenter.multiplyScalar(0.25).sub(pathCenter);
          faceCenter.addScaledVector(directions[segment], -faceCenter.dot(directions[segment]));
          if (faceCenter.lengthSq() > 0 && faceCenter.normalize().dot(normal) > 0.9) hiddenFaces.add(vertex);
        }
      });
    }
    return hiddenFaces;
  }

  function isRectangularFace(positions, vertex) {
    const corners = Array.from({ length: 4 }, (_, corner) => new three.Vector3().fromBufferAttribute(positions, vertex + corner));
    const edges = corners.map((corner, index) => corners[(index + 1) % 4].clone().sub(corner));
    const scale = Math.max(...edges.map(edge => edge.length()));
    const tolerance = scale * 1e-4;
    const oppositeEdgesMatch = edges[0].clone().add(edges[2]).length() <= tolerance
      && edges[1].clone().add(edges[3]).length() <= tolerance;
    const adjacentEdgesPerpendicular = Math.abs(edges[0].dot(edges[1])) <= edges[0].length() * edges[1].length() * 1e-4;
    return oppositeEdgesMatch && adjacentEdgesPerpendicular;
  }

  function mapSingleCellSideUVs(geometry, uvs, labelAspects, labelMaxFontSizes) {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    if (!positions || !normals || positions.count !== 24) return;

    for (let vertex = 0; vertex + 3 < positions.count; vertex += 4) {
      const normalX = normals.getX(vertex);
      const normalY = normals.getY(vertex);
      const normalZ = normals.getZ(vertex);
      const rightX = Math.abs(normalY) > 0.9 ? 1 : normalZ > 0.9 ? 1 : normalZ < -0.9 ? -1 : 0;
      const rightZ = Math.abs(normalY) > 0.9 ? 0 : normalX > 0.9 ? -1 : normalX < -0.9 ? 1 : 0;
      const upY = Math.abs(normalY) > 0.9 ? 0 : 1;
      const upZ = Math.abs(normalY) > 0.9 ? (normalY > 0 ? -1 : 1) : 0;
      let minRight = Infinity;
      let maxRight = -Infinity;
      let minUp = Infinity;
      let maxUp = -Infinity;

      for (let corner = 0; corner < 4; corner++) {
        const index = vertex + corner;
        const right = positions.getX(index) * rightX + positions.getZ(index) * rightZ;
        const up = positions.getY(index) * upY + positions.getZ(index) * upZ;
        minRight = Math.min(minRight, right);
        maxRight = Math.max(maxRight, right);
        minUp = Math.min(minUp, up);
        maxUp = Math.max(maxUp, up);
      }

      for (let corner = 0; corner < 4; corner++) {
        const index = vertex + corner;
        const right = positions.getX(index) * rightX + positions.getZ(index) * rightZ;
        const up = positions.getY(index) * upY + positions.getZ(index) * upZ;
        uvs.setXY(index, (right - minRight) / (maxRight - minRight), (up - minUp) / (maxUp - minUp));
        labelAspects[index] = (maxRight - minRight) / (maxUp - minUp);
        labelMaxFontSizes[index] = MAX_CUBE_LABEL_FONT_SIZE;
      }
    }
  }
}

export default createHilbertGeometries;
