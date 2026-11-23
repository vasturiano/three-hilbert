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
      const g = new HilbertGeometry(state.order, val, typeof val === 'bigint' ? 1n : 1);
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
    },
    _destructor: function() {
      this.prevLabelAtlas?.dispose();
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

    const propsChanged = props => props.some(p => changedProps.hasOwnProperty(p));
    const atlasChanged = propsChanged(['data', 'label', 'labelColor']);
    const geometriesChanged = propsChanged(['useInstancedMeshes', 'data', 'order', 'padding', 'paddingAbsolute', 'simplifyCurves']);

    const labelAtlas = atlasChanged
      ? state.prevLabelAtlas = (state.prevLabelAtlas?.dispose(), new LabelAtlas(state.data, labelAccessor, labelColorAccessor))
      : state.prevLabelAtlas;

    const { instancedGeometries, fallbackGeometries } = geometriesChanged
      ? state.prevHilbertGeometries = createHilbertGeometries({
          useInstancing: state.useInstancedMeshes,
          data: state.data,
          order: state.order,
          paddingAccessor,
          paddingAbsoluteAccessor,
          simplifyCurves: state.simplifyCurves
      })
      : state.prevHilbertGeometries;

    state.instancedDataMapper
      .onCreateObj(d => {
        const { geometry, instances } = instancedGeometries.get(d);
        const mesh = new three.InstancedMesh(geometry, undefined, d.length);

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

        // Link instanced mesh to each datum
        d.forEach((d, idx) => {
          d.__threeObjHilbert = mesh;
          d.__threeObjInstanceId = idx;
        });

        return mesh;
      })
      .onUpdateObj((mesh, d) => {
        labelAtlas.tagGeometry(mesh.geometry, d, {
          instanced: true,
          backgroundColorAccessor: getColor,
          recomputeLabels: geometriesChanged || atlasChanged
        });

        const transparent = mesh.geometry.getAttribute('opacity').array.some(o => o < 1);
        mesh.material = labelAtlas.getMaterial(transparent);
      })
      .digest([...instancedGeometries.keys()]);

    state.fallbackDataMapper
      .onUpdateObj((obj, d) => {
        if(geometriesChanged) {
          obj.geometry?.dispose();
          obj.geometry = fallbackGeometries.get(d);

          obj.renderOrder = Number(d.length); // Draw larger objects later to reduce transparency issues
        }

        labelAtlas.tagGeometry(obj.geometry, [d], {
          backgroundColorAccessor: getColor,
          recomputeLabels: geometriesChanged || atlasChanged
        });

        const transparent = obj.geometry.getAttribute('opacity').array.some(o => o < 1);
        obj.material = labelAtlas.getMaterial(transparent);
      })
      .digest([...fallbackGeometries.keys()]);
  }
});

export default ThreeHilbert;