# three-hilbert

[![NPM package][npm-img]][npm-url]
[![Build Size][build-size-img]][build-size-url]
[![NPM Downloads][npm-downloads-img]][npm-downloads-url]

**three-hilbert** is a [Three.js](https://threejs.org/) object for visualizing data as segments along a 3D Hilbert curve. Map each datum to a range on the curve, then add the object to a Three.js scene like any other `Group`.

## Quick start

```js
import ThreeHilbert from 'three-hilbert';
```
or using a *script* tag
```html
<script src="//cdn.jsdelivr.net/npm/three-hilbert"></script>
```
then
```js
const curveOrder = 4;
const numCells = 8 ** curveOrder;

const hilbert = new ThreeHilbert()
  .order(curveOrder)
  .data([
    { name: 'Group A', start: 0, length: numCells / 2 },
    { name: 'Group B', start: numCells / 2, length: numCells / 2 }
  ]);

const myScene = new THREE.Scene();
myScene.add(myGraph);
```

The ranges in `data` refer to positions along the curve. For an order of `n`, the curve has `8 ** n` positions. `start` is the first position of a segment and `length` is its length. Assign ranges that fit within the curve and do not overlap if you want each position to represent just one datum.

## API reference

All properties are getter/setters: call a method without an argument to read its current value, or pass a value to set it. Setters are chainable.

| Method | Description | Default |
| --- | --- | --- |
| `order([number])` | Hilbert curve order. The curve has `8 ** order` positions. | `4` |
| `data([array])` | Array of segment records. Each record must have numeric `start` and `length` values; additional fields can be used by accessors. | `[]` |
| `padding([accessor])` | Per-segment padding passed to the curve geometry. Accepts a constant, a property name, or a function of the datum. | `0` |
| `color([accessor])` | Segment color as a constant, property name, or function of the datum. Without a color, segments are colored by their `label` value using an ordinal palette. | Automatic |
| `label([accessor])` | Datum value used to label and group segments for automatic coloring. Accepts a constant, property name, or function of the datum. | `'name'` |
| `labelColor([accessor])` | Label color accessor. | `'white'` |
| `simplifyCurves([boolean])` | Whether to simplify the segment geometry whenever possible, to improve rendering performance. | `true` |

### Methods

| Method | Description |
| --- | --- |
| `getVectorAtVal(value)` | Returns a `THREE.Vector3` at a position along the curve. |
| `getRangeBbox(start, length)` | Returns a `THREE.Box3` bounding the specified range. |

## ❤️ Support This Project

If you find this module useful and would like to support its development, you can [buy me a ☕](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=L398E7PKP47E8&currency_code=USD&source=url). Your contributions help keep open-source sustainable!
[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=L398E7PKP47E8&currency_code=USD&source=url)

[npm-img]: https://img.shields.io/npm/v/three-hilbert
[npm-url]: https://npmjs.org/package/three-hilbert
[build-size-img]: https://img.shields.io/bundlephobia/minzip/three-hilbert
[build-size-url]: https://bundlephobia.com/result?p=three-hilbert
[npm-downloads-img]: https://img.shields.io/npm/dt/three-hilbert
[npm-downloads-url]: https://www.npmtrends.com/three-hilbert