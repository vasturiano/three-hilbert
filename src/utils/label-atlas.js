import * as three from 'three';

import { colorAlpha, colorStr2Hex } from './color-utils';

const MAX_LABEL_CHARS = 32;
const GLYPH_COUNT = 256;
const GLYPHS_PER_ROW = 16;
const GLYPH_SIZE = 64;
const MAX_LABEL_FONT_SIZE = 0.8;
const MIN_LABEL_FONT_SIZE = 0.05;
const MAX_LABEL_WIDTH = 0.92;
const LABEL_CHARACTER_ADVANCE = 0.8;

export default class LabelAtlas {
  constructor(data, labelAccessor, labelColorAccessor) {
    const labelIds = new Map();
    this.labels = new WeakMap();
    this.materialCache = new Map();
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
      this.labels.set(d, {
        id,
        length: Array.from(text).length,
        text,
        color
      });
    });

    this.labelCount = labelIds.size;
    if (!this.labelCount) return;

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

    this.glyphTexture = new three.CanvasTexture(glyphCanvas);
    this.glyphTexture.magFilter = three.LinearFilter;
    this.glyphTexture.minFilter = three.LinearFilter;
    if (three.SRGBColorSpace) this.glyphTexture.colorSpace = three.SRGBColorSpace;

    this.labelsPerRow = 128;
    const textureWidth = this.labelsPerRow * MAX_LABEL_CHARS;
    const textureHeight = Math.ceil(labelIds.size / this.labelsPerRow);
    const labelData = new Uint8Array(textureWidth * textureHeight * 4);
    labelIds.forEach((id, text) => {
      Array.from(text).forEach((character, charIndex) => {
        const code = character.codePointAt(0);
        const x = (id % this.labelsPerRow) * MAX_LABEL_CHARS + charIndex;
        const y = Math.floor(id / this.labelsPerRow);
        const supported = code >= 32 && code <= 255 && (code < 127 || code >= 160);
        labelData[(y * textureWidth + x) * 4] = supported ? code : 63;
      });
    });

    this.labelTexture = new three.DataTexture(
      labelData,
      textureWidth,
      textureHeight,
      three.RGBAFormat,
      three.UnsignedByteType
    );
    this.labelTexture.magFilter = three.NearestFilter;
    this.labelTexture.minFilter = three.NearestFilter;
    this.labelTexture.generateMipmaps = false;
    this.labelTexture.needsUpdate = true;
  }

  isEmpty() {
    return this.labelCount === 0;
  }

  tagGeometry(geometry, records, instanced = false) {
    if (this.isEmpty()) return;

    const vertexCount = geometry.getAttribute('position').count;
    const count = instanced ? records.length : vertexCount;
    const makeAttribute = (array, itemSize) => instanced
      ? new three.InstancedBufferAttribute(array, itemSize)
      : new three.Float32BufferAttribute(array, itemSize);

    const ids = new Float32Array(count);
    const lengths = new Float32Array(count);
    const colors = new Float32Array(count * 4);
    const dummyAspectRatio = new Float32Array(count);
    records.forEach((d, index) => {
      if (!this.labels.has(d)) {
        console.warn(`Label not found for record ${JSON.stringify(d)}. Skipping...`);
        return;
      }
      const label = this.labels.get(d);
      const labelColor = label?.color;
      const color = new three.Color(labelColor ? colorStr2Hex(labelColor) : 0xffffff);
      const opacity = labelColor ? colorAlpha(labelColor) : 0;
      const id = label ? label.id : -1;
      const len = label ? label.length : 0;
      const start = instanced ? index : 0;
      const end = instanced ? index + 1 : count;
      for (let i = start; i < end; i++) {
        ids[i] = id;
        lengths[i] = len;
        colors[i * 4] = color.r;
        colors[i * 4 + 1] = color.g;
        colors[i * 4 + 2] = color.b;
        colors[i * 4 + 3] = opacity;
        dummyAspectRatio[i] = 2.0;
      }
    });

    geometry.setAttribute('labelId', makeAttribute(ids, 1));
    geometry.setAttribute('labelLength', makeAttribute(lengths, 1));
    geometry.setAttribute('labelColor', makeAttribute(colors, 4));

    if (!geometry.getAttribute('aspectRatio')) {
      console.warn(`Geometry requires aspectRatio attribute. Setting 2.0 throughout the faces.`);
      geometry.setAttribute('aspectRatio', makeAttribute(dummyAspectRatio, 1));
    }
  }

  getMaterial(color) {
    let material = this.materialCache.get(color);
    if (material) return material;

    material = new three.MeshLambertMaterial();
    this.materialCache.set(color, material);

    const opacity = colorAlpha(color);
    material.color.set(colorStr2Hex(color));
    material.transparent = opacity < 1;
    material.opacity = opacity;

    if (!this.isEmpty()) {
      material.onBeforeCompile = shader => {
        shader.uniforms.labelGlyphTexture = {value: this.glyphTexture};
        shader.uniforms.labelDataTexture = {value: this.labelTexture};
        shader.uniforms.labelDataTextureSize = {
          value: new three.Vector2(this.labelTexture.image.width, this.labelTexture.image.height)
        };
        shader.uniforms.labelLabelsPerRow = {value: this.labelsPerRow};

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
         attribute float aspectRatio;
         attribute vec4 labelColor;
         attribute float labelId;
         attribute float labelLength;
         varying float vAspectRatio;
         varying vec4 vLabelColor;
         varying float vLabelId;
         varying float vLabelLength;
         varying vec2 vLabelUv;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
         vAspectRatio = aspectRatio;
         vLabelColor = labelColor;
         vLabelId = labelId;
         vLabelLength = labelLength;
         vLabelUv = uv;`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
         uniform sampler2D labelGlyphTexture;
         uniform sampler2D labelDataTexture;
         uniform vec2 labelDataTextureSize;
         uniform float labelLabelsPerRow;
         varying float vAspectRatio;
         varying vec4 vLabelColor;
         varying float vLabelId;
         varying float vLabelLength;
         varying vec2 vLabelUv;`
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
         if (vLabelId >= 0.0 && vLabelUv.x >= 0.0 && vLabelUv.x <= 1.0) {
           float aspect = max(vAspectRatio, 0.001);
           float visibleLength = vLabelLength;
           float textUnits = 1.0 + max(visibleLength - 1.0, 0.0) * ${LABEL_CHARACTER_ADVANCE.toFixed(2)};
           float maxFontSize = ${MAX_LABEL_FONT_SIZE.toFixed(2)};
           float fontSize = min(maxFontSize, aspect * ${MAX_LABEL_WIDTH.toFixed(2)} / textUnits);
           bool isTruncated = fontSize < ${MIN_LABEL_FONT_SIZE.toFixed(2)};
           if (isTruncated) visibleLength = min(visibleLength, max(3.0, floor((aspect * ${MAX_LABEL_WIDTH.toFixed(2)} / ${MIN_LABEL_FONT_SIZE.toFixed(2)} - 1.0) / ${LABEL_CHARACTER_ADVANCE.toFixed(2)}) + 1.0));
           textUnits = 1.0 + max(visibleLength - 1.0, 0.0) * ${LABEL_CHARACTER_ADVANCE.toFixed(2)};
           fontSize = min(maxFontSize, aspect * ${MAX_LABEL_WIDTH.toFixed(2)} / textUnits);
           float characterSize = fontSize / aspect;
           float characterAdvance = characterSize * ${LABEL_CHARACTER_ADVANCE.toFixed(2)};
           float textWidth = characterSize + characterAdvance * max(visibleLength - 1.0, 0.0);
           float textStart = (1.0 - textWidth) * 0.5;
           float textPosition = vLabelUv.x - textStart;
           if (textPosition >= 0.0 && textPosition < textWidth) {
             float glyphVerticalPosition = (vLabelUv.y - 0.5) / max(fontSize, 0.001) + 0.5;
             if (glyphVerticalPosition >= 0.0 && glyphVerticalPosition <= 1.0) {
             float charPosition = textPosition / max(characterAdvance, 0.001);
             float charIndex = floor(charPosition);
             float glyphHorizontalPosition = (textPosition - charIndex * characterAdvance) / max(characterSize, 0.001);
             float labelRow = floor(vLabelId / labelLabelsPerRow);
             float labelColumn = mod(vLabelId, labelLabelsPerRow);
             vec2 dataUv = (vec2(labelColumn * ${MAX_LABEL_CHARS}.0 + charIndex, labelRow) + 0.5) / labelDataTextureSize;
             float charCode = floor(texture2D(labelDataTexture, dataUv).r * 255.0 + 0.5);
             if (isTruncated && charIndex >= visibleLength - 3.0) charCode = 46.0;
             vec2 glyphCell = vec2(mod(charCode, 16.0), floor(charCode / 16.0));
             vec2 glyphUv = vec2(0.015625 + clamp(glyphHorizontalPosition, 0.0, 1.0) * 0.96875, 0.015625 + (1.0 - glyphVerticalPosition) * 0.96875);
             vec2 glyphAtlasUv = vec2(glyphCell.x + glyphUv.x, 16.0 - glyphCell.y - glyphUv.y) / 16.0;
             float glyphCoverage = texture2D(labelGlyphTexture, glyphAtlasUv).a;
               float previousCharIndex = charIndex - 1.0;
               float previousGlyphPosition = (textPosition - previousCharIndex * characterAdvance) / max(characterSize, 0.001);
               if (charIndex > 0.0 && previousGlyphPosition < 1.0) {
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
             float glyphAlpha = glyphCoverage * vLabelColor.a;
             diffuseColor.rgb = mix(diffuseColor.rgb, vLabelColor.rgb, glyphAlpha);
             }
           }
         }`
        );
      };
      material.customProgramCacheKey = () => 'three-label-glyph-atlas';
    }

    return material;
  }

  dispose() {
    this.glyphTexture?.dispose();
    this.labelTexture?.dispose();
  }
}
