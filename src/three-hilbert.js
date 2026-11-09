import Kapsule from 'kapsule';
import accessorFn from 'accessor-fn';

import * as three from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import HilbertGeometry from 'three-hilbert-geometry';
import { scaleOrdinal as d3ScaleOrdinal } from 'd3-scale';
import { schemePaired as d3SchemePaired } from 'd3-scale-chromatic';

import { deallocate, emptyObject } from './utils/gc';
import ThreeDigest from './utils/digest';
import { colorAlpha, colorStr2Hex } from './utils/color-utils';

import createInstancedHilbertMeshes from './instanced-hilbert-meshes';

const SCALE = 100;
const MAX_VISIBLE_LABELS = 20;
const MIN_LABEL_SIZE = 0.005;

const ThreeHilbert = Kapsule({
  props: {
    order: { default: 4 }, // 0-4096 default
    data: { default: [] },
    padding: { default: 0 },
    color: {},
    label: { default: 'name' },
    labelColor: { default: () => 'lavender' },
    simplifyCurves: { default: true },
    useInstancedMeshes: { default: false }
  },
  methods: {
    setPointOfView: (state, camera) => {
      let root = state.scene;
      while (root.parent) root = root.parent;
      root.updateWorldMatrix(true, true);
      camera.updateWorldMatrix(true, false);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

      const cameraPosition = camera.getWorldPosition(new three.Vector3());
      const cameraViewMatrix = camera.matrixWorldInverse;
      const raycaster = new three.Raycaster();
      const intersections = [];
      const position = new three.Vector3();
      const viewPosition = new three.Vector3();
      const direction = new three.Vector3();
      const ndc = new three.Vector3();
      const candidates = [];
      state.labels.forEach((label, index) => {
        position.copy(label.center).applyMatrix4(state.scene.matrixWorld);
        const viewDepth = -viewPosition.copy(position).applyMatrix4(cameraViewMatrix).z;
        const distance = position.distanceTo(cameraPosition);
        const relativeSize = label.radius * state.scene.matrixWorld.getMaxScaleOnAxis() / distance;
        if (
          label.radius > 0 &&
          viewDepth > 0 &&
          viewDepth <= (camera.far ?? Infinity) &&
          relativeSize >= MIN_LABEL_SIZE
        ) {
          candidates.push({ label, index, relativeSize });
        }
      });

      // const visibleLabels = [];
      const visibleLabels = candidates
        .sort((a, b) => b.relativeSize - a.relativeSize || a.index - b.index)
        .slice(0, MAX_VISIBLE_LABELS);
      ; // []
      [] //candidates
        .sort((a, b) => b.relativeSize - a.relativeSize || a.index - b.index)
        .some(candidate => {
          position.copy(candidate.label.center).applyMatrix4(state.scene.matrixWorld);
          ndc.copy(position).project(camera);
          raycaster.setFromCamera(ndc, camera);
          const distance = direction.copy(position).sub(raycaster.ray.origin).dot(raycaster.ray.direction);
          raycaster.far = Math.max(0, distance - 1e-5);
          intersections.length = 0;
          raycaster.intersectObjects(root.children, true, intersections);
          if (!intersections.some(hit => getIntersectionDatum(hit) !== candidate.label.datum)) {
            visibleLabels.push(candidate);
          }
          return visibleLabels.length >= MAX_VISIBLE_LABELS;
        });

      const nextVisible = new Set(visibleLabels.map(({ label }) => label));
      state.labels.forEach(label => {
        if (label.object && !nextVisible.has(label)) {
          state.scene.remove(label.object);
          label.object.visible = false;
          state.labelPool.push(label.object);
          label.object = null;
        }
      });
      visibleLabels.forEach(({ label }) => {
        if (!label.object) {
          const object = state.labelPool.pop() || createLabelObject();
          object.element.textContent = label.text;
          object.element.style.color = label.color;
          object.position.copy(label.center);
          label.object = object;
          state.scene.add(object);
        }
        label.object.visible = true;
      });
      return visibleLabels.length;
    },
    getPositionAtVal: (state, val) => {
      const g = new HilbertGeometry(state.order, val, 1);
      g.computeBoundingSphere();
      return g.boundingSphere.center.clone().multiplyScalar(SCALE);
    },
    getRangeBbox: (state, start, length) => {
      const g = new HilbertGeometry(state.order, start, length);
      g.computeBoundingBox();
      const bbox = g.boundingBox.clone();
      g.dispose();
      bbox.min.multiplyScalar(SCALE);
      bbox.max.multiplyScalar(SCALE);
      return bbox;
    }
  },
  stateInit() { return {
    defaultColorScale: d3ScaleOrdinal(d3SchemePaired),
    instancedMeshes: [],
    labels: [],
    labelPool: []
  } },

  init: function(threeObj, state) {
    emptyObject(threeObj);

    // Main three object to manipulate
    state.scene = threeObj;

    state.dataMapper = new ThreeDigest(threeObj, { objBindAttr: '__threeObjHilbert' })
      .onCreateObj(() => {
        const obj = new three.Group(); // container
        obj.add(new three.Mesh()) // hilbert curve

        obj.scale.set(SCALE, SCALE, SCALE);
        return obj;
      });
  },
  update: function(state, changedProps) {
    // Data accessors
    const paddingAccessor = accessorFn(state.padding);
    const colorAccessor = accessorFn(state.color);
    const labelAccessor = accessorFn(state.label);
    const labelColorAccessor = accessorFn(state.labelColor);

    state.labels.forEach(({ object }) => {
      if (object) {
        state.scene.remove(object);
        object.element.remove();
      }
    });
    state.labelPool.forEach(object => object.element.remove());
    state.labels = [];
    state.labelPool = [];

    state.data.forEach(d => {
      const text = labelAccessor(d);
      if (text == null || text === '') return;

      const color = labelColorAccessor(d);
      if (!color) return;
      const bounds = state.scene.getRangeBbox(d.start, d.length);
      const sphere = bounds.getBoundingSphere(new three.Sphere());
      state.labels.push({
        datum: d,
        text: String(text),
        color: typeof color === 'number'
          ? `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`
          : color,
        center: sphere.center,
        radius: sphere.radius,
        object: null
      });
    });

    const {
      fallbackData,
      geometries,
      meshes: instancedMeshes
    } = createInstancedHilbertMeshes({
      useInstancing: state.useInstancedMeshes,
      data: state.data,
      order: state.order,
      paddingAccessor,
      colorAccessor,
      labelAccessor,
      defaultColorScale: state.defaultColorScale,
      simplifyCurves: state.simplifyCurves,
      SCALE
    });

    state.instancedMeshes.forEach(mesh => {
      state.scene.remove(mesh);
      deallocate(mesh);
    });
    state.instancedMeshes = instancedMeshes;
    instancedMeshes.forEach(mesh => state.scene.add(mesh));

    const materialCache = new Map();
    state.dataMapper
      .onUpdateObj((obj, d) => {
        const [hilbertObj] = obj.children;

        // update color
        const color = colorAccessor?.(d) || (state.defaultColorScale(labelAccessor(d) || ''));
        let material = materialCache.get(color);
        if (!material) {
          const opacity = colorAlpha(color);
          material = new three.MeshLambertMaterial();
          material.color.set(colorStr2Hex(color));
          material.transparent = opacity < 1;
          material.opacity = opacity;
          materialCache.set(color, material);
        }
        hilbertObj.material = material;

        hilbertObj.geometry?.dispose();
        hilbertObj.geometry = geometries.get(d);
      })
      .digest(fallbackData);
  }
});

function createLabelObject() {
  const element = document.createElement('div');
  element.className = 'three-hilbert-label';
  element.style.fontFamily = 'sans-serif';
  element.style.whiteSpace = 'nowrap';
  element.style.textAlign = 'center';
  element.style.pointerEvents = 'none';
  return new CSS2DObject(element);
}

function getIntersectionDatum(intersection) {
  const { object, instanceId } = intersection;
  if (instanceId != null) return object.userData.data?.[instanceId];
  return object.userData.threeHilbertDatum ?? object.parent?.__data;
}

export default ThreeHilbert;