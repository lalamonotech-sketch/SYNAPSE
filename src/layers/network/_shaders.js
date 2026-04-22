/**
 * SYNAPSE — Layer 1 GLSL shader sources
 *
 * Plain string constants. Imported by layer1.js when constructing
 * RawShaderMaterial / ShaderMaterial instances for the link batch and
 * the additive flow overlay.
 */

export const LINK_VERTEX_SHADER = `
attribute vec4 colorAlpha;
varying vec4 vColor;
void main() {
  vColor = colorAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const LINK_FRAGMENT_SHADER = `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

// UV-aware shaders for the additive flow overlay.
// 'arcT' carries normalized arc position (0..1 along link),
// 'speedT' is the per-vertex speed factor (link type encoded at write time).
export const FLOW_VERT = `
attribute vec4  colorAlpha;
attribute float arcT;
attribute float speedT;
varying   vec4  vColor;
varying   float vArcT;
varying   float vSpeedT;
void main() {
  vColor  = colorAlpha;
  vArcT   = arcT;
  vSpeedT = speedT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// dash pattern: bright zone ~40%, gap ~60%, texture repeats 4× along link.
export const FLOW_FRAG = `
uniform sampler2D uFlowTex;
uniform float     uOffset;
varying vec4  vColor;
varying float vArcT;
varying float vSpeedT;
void main() {
  float ucoord = fract(vArcT * 4.0 + uOffset * vSpeedT);
  float dash   = texture2D(uFlowTex, vec2(ucoord, 0.5)).r;
  gl_FragColor = vec4(vColor.rgb * dash, vColor.a * dash);
}
`;
