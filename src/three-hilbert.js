import Kapsule from 'kapsule';
import accessorFn from 'accessor-fn';

import * as three from 'three';
import ThreeHilbertGeometry from 'three-hilbert-geometry';
import SpriteText from 'three-spritetext';
import { scaleOrdinal as d3ScaleOrdinal } from 'd3-scale';
import { schemePaired as d3SchemePaired } from 'd3-scale-chromatic';

import { emptyObject } from './utils/gc';
import ThreeDigest from './utils/digest';
import { colorAlpha, colorStr2Hex } from "./utils/color-utils";

const SCALE = 100;

const ThreeHilbert = Kapsule({
  props: {
    order: { default: 4 }, // 0-4096 default
    data: { default: [] },
    padding: { default: 0 },
    color: {},
    label: { default: 'name' },
    labelColor: { default: () => 'white' },
    simplifyCurves: { default: true }
  },
  methods: {
    getVectorAtVal: (state, val) => {
      const g = new ThreeHilbertGeometry(state.order, val, 1);
      g.computeBoundingSphere();
      const vec = g.boundingSphere.center.clone().multiplyScalar(SCALE);
      return vec;
    },
    getRangeBbox: (state, start, length) => {
      const g = new ThreeHilbertGeometry(state.order, start, length);
      g.computeBoundingBox();
      const bbox = g.boundingBox.clone();
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

    state.dataMapper = new ThreeDigest(threeObj, { objBindAttr: '__threeObjHilbert' })
      .onCreateObj(() => {
        const obj = new three.Group(); // container
        obj.add(new three.Mesh()); // hilbert curve
        // obj.add(new SpriteText()); // label

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

    const materialCache = {};

    const sd = new Date();
    state.dataMapper
      .onUpdateObj((obj, d) => {
        const [hilbertObj, labelObj] = obj.children;

        // update color
        const color = colorAccessor?.(d) || (state.defaultColorScale(labelAccessor(d) || ''));
        if (!materialCache[color]) {
          const opacity = colorAlpha(color);
          const material = materialCache[color] = new three.MeshLambertMaterial();
          material.color.set(colorStr2Hex(color));
          material.transparent = opacity < 1;
          material.opacity = opacity;
        }
        hilbertObj.material?.dispose();
        hilbertObj.material = materialCache[color];

        hilbertObj.geometry?.dispose();
        hilbertObj.geometry = new ThreeHilbertGeometry(
          state.order,
          d.start,
          d.length,
          { padding: paddingAccessor(d), simplifyCurves: state.simplifyCurves }
        );

        // console.log(getCurvePath(hilbertObj.geometry.parameters.points), hilbertObj.geometry.parameters.points);

        /*
        // update label
        labelObj.text = labelAccessor?.(d) || '';
        labelObj.color = labelColorAccessor(d);
        labelObj.textHeight = 0.8 * d.length / Math.pow(8, state.order);
        hilbertObj.geometry.computeBoundingSphere();
        labelObj.position.copy(hilbertObj.geometry.boundingSphere.center);
         */
      })
      .digest(state.data);
  }
});

export default ThreeHilbert;