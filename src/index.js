import { Group } from 'three';

import ForceGraph from './three-hilbert.js';
import fromKapsule from './utils/kapsule-class.js';

export default fromKapsule(ForceGraph, Group, true);