import Kapsule from 'kapsule';
import accessorFn from 'accessor-fn';

import * as three from 'three';
import HilbertGeometry from 'three-hilbert-geometry';
import { scaleOrdinal as d3ScaleOrdinal } from 'd3-scale';
import { schemePaired as d3SchemePaired } from 'd3-scale-chromatic';

import { deallocate, emptyObject } from './utils/gc';
import ThreeDigest from './utils/digest';
import { colorAlpha, colorStr2Hex } from './utils/color-utils';

import createInstancedHilbertMeshes from './instanced-hilbert-meshes';

const SCALE = 100;

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
    instancedMeshes: []
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

export default ThreeHilbert;