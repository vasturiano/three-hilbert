import * as three from 'three';

import { colorAlpha, colorStr2Hex } from './color-utils';

const MAX_LABEL_CHARS = 32;
const GLYPH_COUNT = 256;
const GLYPHS_PER_ROW = 16;
const GLYPH_SIZE = 64;
const MIN_LABEL_FONT_SIZE = 0.05;
const MAX_LABEL_FONT_SIZE = 0.8;
const MAX_CUBE_LABEL_FONT_SIZE = 0.5;
const MAX_LABEL_WIDTH = 0.92;
const LABEL_CHARACTER_ADVANCE = 0.8;

function createLabelAtlas(data, labelAccessor, labelColorAccessor) {
  const labelIds = new Map();
  const labels = new WeakMap();
  data.forEach(d => {
    const label = labelAccessor(d);
    const color = labelColorAccessor(d);
    if (!label || !color) return;

    const characters = Array.from(String(label));
    const text = characters.length > MAX_LABEL_CHARS
      ? `${characters.slice(0, MAX_LABEL_CHARS - 3).join('')}...`
      : characters.join('');
    let id = labelIds.get(text);
    if (id === undefined) {
      id = labelIds.size;
      labelIds.set(text, id);
    }
    labels.set(d, {
      id,
      length: Array.from(text).length,
      text,
      color
    });
  });

  if (!labelIds.size) return null;

  const glyphCanvas = document.createElement('canvas');
  glyphCanvas.width = GLYPHS_PER_ROW * GLYPH_SIZE;
  glyphCanvas.height = GLYPHS_PER_ROW * GLYPH_SIZE;
  const glyphContext = glyphCanvas.getContext('2d');
  if (!glyphContext) throw new Error('Unable to create canvas context for label glyphs');
  glyphContext.font = 'bold 64px monospace';
  glyphContext.textAlign = 'center';
  glyphContext.textBaseline = 'middle';
  for (let code = 0; code < GLYPH_COUNT; code++) {
    const character = String.fromCharCode(code);
    if (code < 32 || code === 127) continue;
    const x = (code % GLYPHS_PER_ROW) * GLYPH_SIZE + GLYPH_SIZE / 2;
    const y = Math.floor(code / GLYPHS_PER_ROW) * GLYPH_SIZE + GLYPH_SIZE / 2;
    glyphContext.fillStyle = '#fff';
    glyphContext.fillText(character, x, y);
  }

  const glyphTexture = new three.CanvasTexture(glyphCanvas);
  glyphTexture.magFilter = three.LinearFilter;
  glyphTexture.minFilter = three.LinearFilter;
  if (three.SRGBColorSpace) glyphTexture.colorSpace = three.SRGBColorSpace;

  const labelsPerRow = 128;
  const textureWidth = labelsPerRow * MAX_LABEL_CHARS;
  const textureHeight = Math.ceil(labelIds.size / labelsPerRow);
  const labelData = new Uint8Array(textureWidth * textureHeight * 4);
  labelIds.forEach((id, text) => {
    Array.from(text).forEach((character, charIndex) => {
      const code = character.codePointAt(0);
      const x = (id % labelsPerRow) * MAX_LABEL_CHARS + charIndex;
      const y = Math.floor(id / labelsPerRow);
      const supported = code >= 32 && code <= 255 && (code < 127 || code >= 160);
      labelData[(y * textureWidth + x) * 4] = supported ? code : 63;
    });
  });

  const labelTexture = new three.DataTexture(
    labelData,
    textureWidth,
    textureHeight,
    three.RGBAFormat,
    three.UnsignedByteType
  );
  labelTexture.magFilter = three.NearestFilter;
  labelTexture.minFilter = three.NearestFilter;
  labelTexture.generateMipmaps = false;
  labelTexture.needsUpdate = true;

  return {
    labels,
    glyphTexture,
    labelTexture,
    labelsPerRow,
    labelCount: labelIds.size
  };
}

function createLabelMaterial(color, labelAtlas) {
  const material = new three.MeshLambertMaterial();
  const opacity = colorAlpha(color);
  material.color.set(colorStr2Hex(color));
  material.transparent = opacity < 1;
  material.opacity = opacity;

  if (labelAtlas) {
    material.onBeforeCompile = shader => {
      shader.uniforms.labelGlyphTexture = { value: labelAtlas.glyphTexture };
      shader.uniforms.labelDataTexture = { value: labelAtlas.labelTexture };
      shader.uniforms.labelDataTextureSize = {
        value: new three.Vector2(labelAtlas.labelTexture.image.width, labelAtlas.labelTexture.image.height)
      };
      shader.uniforms.labelLabelsPerRow = { value: labelAtlas.labelsPerRow };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute float hilbertLabelId;
           attribute float hilbertLabelLength;
           attribute float hilbertLabelAspect;
           attribute float hilbertLabelMaxFontSize;
           attribute float hilbertLabelReverse;
           attribute vec4 hilbertLabelColor;
           varying vec2 vHilbertLabelUv;
           varying float vHilbertLabelId;
           varying float vHilbertLabelLength;
           varying float vHilbertLabelAspect;
           varying float vHilbertLabelMaxFontSize;
           varying float vHilbertLabelReverse;
           varying vec4 vHilbertLabelColor;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vHilbertLabelUv = uv;
           vHilbertLabelId = hilbertLabelId;
           vHilbertLabelLength = hilbertLabelLength;
           vHilbertLabelAspect = hilbertLabelAspect;
           vHilbertLabelMaxFontSize = hilbertLabelMaxFontSize;
           vHilbertLabelReverse = hilbertLabelReverse;
           vHilbertLabelColor = hilbertLabelColor;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D labelGlyphTexture;
           uniform sampler2D labelDataTexture;
           uniform vec2 labelDataTextureSize;
           uniform float labelLabelsPerRow;
           varying vec2 vHilbertLabelUv;
           varying float vHilbertLabelId;
           varying float vHilbertLabelLength;
           varying float vHilbertLabelAspect;
           varying float vHilbertLabelMaxFontSize;
           varying float vHilbertLabelReverse;
           varying vec4 vHilbertLabelColor;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           if (vHilbertLabelId >= 0.0 && vHilbertLabelUv.x >= 0.0 && vHilbertLabelUv.x <= 1.0) {
             float aspect = max(vHilbertLabelAspect, 0.001);
             float visibleLength = vHilbertLabelLength;
             float textUnits = 1.0 + max(visibleLength - 1.0, 0.0) * ${LABEL_CHARACTER_ADVANCE.toFixed(2)};
             float maxFontSize = min(${MAX_LABEL_FONT_SIZE.toFixed(2)}, vHilbertLabelMaxFontSize);
             float fontSize = min(maxFontSize, aspect * ${MAX_LABEL_WIDTH.toFixed(2)} / textUnits);
             bool isTruncated = fontSize < ${MIN_LABEL_FONT_SIZE.toFixed(2)};
             if (isTruncated) visibleLength = min(visibleLength, max(3.0, floor((aspect * ${MAX_LABEL_WIDTH.toFixed(2)} / ${MIN_LABEL_FONT_SIZE.toFixed(2)} - 1.0) / ${LABEL_CHARACTER_ADVANCE.toFixed(2)}) + 1.0));
             textUnits = 1.0 + max(visibleLength - 1.0, 0.0) * ${LABEL_CHARACTER_ADVANCE.toFixed(2)};
             fontSize = min(maxFontSize, aspect * ${MAX_LABEL_WIDTH.toFixed(2)} / textUnits);
             float characterSize = fontSize / aspect;
             float characterAdvance = characterSize * ${LABEL_CHARACTER_ADVANCE.toFixed(2)};
             float textWidth = characterSize + characterAdvance * max(visibleLength - 1.0, 0.0);
             float textStart = (1.0 - textWidth) * 0.5;
             float textPosition = vHilbertLabelUv.x - textStart;
             if (textPosition >= 0.0 && textPosition < textWidth) {
               float glyphVerticalPosition = (vHilbertLabelUv.y - 0.5) / max(fontSize, 0.001) + 0.5;
               if (glyphVerticalPosition >= 0.0 && glyphVerticalPosition <= 1.0) {
               float charPosition = textPosition / max(characterAdvance, 0.001);
               float charSlot = floor(charPosition);
               float charIndex = mix(charSlot, visibleLength - 1.0 - charSlot, vHilbertLabelReverse);
               float glyphHorizontalPosition = (textPosition - charSlot * characterAdvance) / max(characterSize, 0.001);
               glyphHorizontalPosition = mix(glyphHorizontalPosition, 1.0 - glyphHorizontalPosition, vHilbertLabelReverse);
               float labelRow = floor(vHilbertLabelId / labelLabelsPerRow);
               float labelColumn = mod(vHilbertLabelId, labelLabelsPerRow);
               vec2 dataUv = (vec2(labelColumn * ${MAX_LABEL_CHARS}.0 + charIndex, labelRow) + 0.5) / labelDataTextureSize;
               float charCode = floor(texture2D(labelDataTexture, dataUv).r * 255.0 + 0.5);
               if (isTruncated && charIndex >= visibleLength - 3.0) charCode = 46.0;
               vec2 glyphCell = vec2(mod(charCode, 16.0), floor(charCode / 16.0));
               vec2 glyphUv = vec2(0.015625 + clamp(glyphHorizontalPosition, 0.0, 1.0) * 0.96875, 0.015625 + (1.0 - glyphVerticalPosition) * 0.96875);
               vec2 glyphAtlasUv = vec2(glyphCell.x + glyphUv.x, 16.0 - glyphCell.y - glyphUv.y) / 16.0;
               float glyphCoverage = texture2D(labelGlyphTexture, glyphAtlasUv).a;
                 float previousCharSlot = charSlot - 1.0;
                 float previousCharIndex = mix(previousCharSlot, visibleLength - 1.0 - previousCharSlot, vHilbertLabelReverse);
                 float previousGlyphPosition = (textPosition - previousCharSlot * characterAdvance) / max(characterSize, 0.001);
                 previousGlyphPosition = mix(previousGlyphPosition, 1.0 - previousGlyphPosition, vHilbertLabelReverse);
                 if (charSlot > 0.0 && previousGlyphPosition < 1.0) {
                   vec2 previousDataUv = (vec2(labelColumn * ${MAX_LABEL_CHARS}.0 + previousCharIndex, labelRow) + 0.5) / labelDataTextureSize;
                 float previousCharCode = floor(texture2D(labelDataTexture, previousDataUv).r * 255.0 + 0.5);
                   if (isTruncated && previousCharIndex >= visibleLength - 3.0) previousCharCode = 46.0;
                 vec2 previousGlyphCell = vec2(mod(previousCharCode, 16.0), floor(previousCharCode / 16.0));
                 vec2 previousGlyphAtlasUv = vec2(
                   previousGlyphCell.x + 0.015625 + clamp(previousGlyphPosition, 0.0, 1.0) * 0.96875,
                   16.0 - previousGlyphCell.y - glyphUv.y
                 ) / 16.0;
                 glyphCoverage = max(glyphCoverage, texture2D(labelGlyphTexture, previousGlyphAtlasUv).a);
               }
               float glyphAlpha = glyphCoverage * vHilbertLabelColor.a;
               diffuseColor.rgb = mix(diffuseColor.rgb, vHilbertLabelColor.rgb, glyphAlpha);
               }
             }
           }`
        );
    };
    material.customProgramCacheKey = () => 'three-hilbert-label-glyph-atlas';
  }
  return material;
}

function addLabelAttributes(geometry, records, instanced = false) {
  const vertexCount = geometry.getAttribute('position').count;
  const count = instanced ? records.length : vertexCount;
  const makeAttribute = (array, itemSize) => instanced
    ? new three.InstancedBufferAttribute(array, itemSize)
    : new three.Float32BufferAttribute(array, itemSize);

  const ids = new Float32Array(count);
  const lengths = new Float32Array(count);
  const colors = new Float32Array(count * 4);
  records.forEach(({ info }, index) => {
    const labelColor = info?.color;
    const color = new three.Color(labelColor ? colorStr2Hex(labelColor) : 0xffffff);
    const start = instanced ? index : 0;
    const end = instanced ? index + 1 : count;
    for (let i = start; i < end; i++) {
      ids[i] = info ? info.id : -1;
      lengths[i] = info ? info.length : 0;
      colors[i * 4] = color.r;
      colors[i * 4 + 1] = color.g;
      colors[i * 4 + 2] = color.b;
      colors[i * 4 + 3] = labelColor ? colorAlpha(labelColor) : 0;
    }
  });

  geometry.setAttribute('hilbertLabelId', makeAttribute(ids, 1));
  geometry.setAttribute('hilbertLabelLength', makeAttribute(lengths, 1));
  geometry.setAttribute('hilbertLabelColor', makeAttribute(colors, 4));
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
  geometry.setAttribute('hilbertLabelAspect', new three.Float32BufferAttribute(labelAspects, 1));
  geometry.setAttribute('hilbertLabelMaxFontSize', new three.Float32BufferAttribute(labelMaxFontSizes, 1));
  geometry.setAttribute('hilbertLabelReverse', new three.Float32BufferAttribute(labelReverse, 1));
  uvs.needsUpdate = true;
}

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

export { addLabelAttributes, createLabelAtlas, createLabelMaterial, mapLabelUVs };
