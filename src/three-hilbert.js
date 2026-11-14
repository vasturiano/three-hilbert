import Kapsule from 'kapsule';
import accessorFn from 'accessor-fn';

import * as three from 'three';
import HilbertGeometry from 'three-hilbert-geometry';
import { scaleOrdinal as d3ScaleOrdinal } from 'd3-scale';
import { schemePaired as d3SchemePaired } from 'd3-scale-chromatic';

import { emptyObject } from './utils/gc';
import ThreeDigest from './utils/digest';
import LabelAtlas from './utils/label-atlas';

import createHilbertGeometries from './instanced-hilbert-geometries.js';

const SCALE = 100;

const ThreeHilbert = Kapsule({
  props: {
    order: { default: 4 }, // 0-4096 default
    data: { default: [] },
    padding: { default: 0 },
    paddingAbsolute: { default: 0 },
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
    defaultColorScale: d3ScaleOrdinal(d3SchemePaired)
  } },

  init: function(threeObj, state) {
    emptyObject(threeObj);

    // Main three object to manipulate
    state.scene = threeObj;
    state.scene.scale.set(SCALE, SCALE, SCALE);

    const instancedG = state.instancedG = new three.Group();
    state.scene.add(instancedG);
    state.instancedDataMapper = new ThreeDigest(instancedG, { objBindAttr: '__threeObjHilbert' });

    const fallbackG = new three.Group();
    state.scene.add(fallbackG);
    state.fallbackDataMapper = new ThreeDigest(fallbackG, { objBindAttr: '__threeObjHilbert' })
      .onCreateObj(() => new three.Mesh());
  },
  update: function(state, changedProps) {
    // Data accessors
    const paddingAccessor = accessorFn(state.padding);
    const paddingAbsoluteAccessor = accessorFn(state.paddingAbsolute);
    const colorAccessor = accessorFn(state.color);
    const labelAccessor = accessorFn(state.label);
    const labelColorAccessor = accessorFn(state.labelColor);
    const getColor = d => colorAccessor?.(d) || state.defaultColorScale(labelAccessor(d) || '');

    const labelAtlas = new LabelAtlas(state.data, labelAccessor, labelColorAccessor);

    const { instancedGeometries, fallbackGeometries } = createHilbertGeometries({
      useInstancing: state.useInstancedMeshes,
      data: state.data,
      order: state.order,
      paddingAccessor,
      paddingAbsoluteAccessor,
      simplifyCurves: state.simplifyCurves
    });

    const instancedMeshes = new Map();
    instancedGeometries.forEach(geometryBatch => {
      const colorBatches = new Map();
      geometryBatch.instances.forEach(instance => {
        // split by color
        const color = getColor(instance.data);
        let batch = colorBatches.get(color);
        if (!batch) {
          batch = { material: labelAtlas.getMaterial(color), instances: [] };
          colorBatches.set(color, batch);
        }
        batch.instances.push(instance);
      });

      colorBatches.forEach(({ material, instances }) => {
        const geometry = geometryBatch.geometry.clone();
        labelAtlas.tagGeometry(geometry, instances.map(instance => instance.data), true);

        const mesh = new three.InstancedMesh(geometry, material, instances.length);
        const matrices = mesh.instanceMatrix.array;
        instances.forEach(({ scale, position }, i) => {
          const matrixOffset = i * 16;
          matrices[matrixOffset] = scale;
          matrices[matrixOffset + 5] = scale;
          matrices[matrixOffset + 10] = scale;
          matrices[matrixOffset + 12] = position.x;
          matrices[matrixOffset + 13] = position.y;
          matrices[matrixOffset + 14] = position.z;
          matrices[matrixOffset + 15] = 1;
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        const data = instances.map(instance => instance.data);
        instancedMeshes.set(data, mesh);
      });
      geometryBatch.geometry.dispose();
    });

    state.instancedDataMapper
      .onCreateObj(d => instancedMeshes.get(d))
      .digest([...instancedMeshes.keys()]);

    [...fallbackGeometries.entries()].forEach(([d, geometry]) => labelAtlas.tagGeometry(geometry, [d]));
    state.fallbackDataMapper
      .onUpdateObj((obj, d) => {
        obj.geometry?.dispose();
        obj.geometry = fallbackGeometries.get(d);
        obj.material = labelAtlas.getMaterial(getColor(d));
      })
      .digest([...fallbackGeometries.keys()]);

    labelAtlas.dispose();
  }
});

export default ThreeHilbert;