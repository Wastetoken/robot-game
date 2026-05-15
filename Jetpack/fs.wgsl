// [[block]] 
struct Uniforms {
  mytimer                  : f32,
};

@group(0) @binding(0) var  mySampler: sampler;
@group(0) @binding(1) var  myTexture: texture_2d<f32>;
@group(0) @binding(2) var <uniform> uniforms : Uniforms;



fn hash(p : vec3<f32>) -> vec3<f32>
{
    p = vec3<f32>(dot(p, vec3<f32>(127.1, 311.7, 74.7)),
                 dot(p, vec3<f32>(269.5, 183.3, 246.1)),
                 dot(p, vec3<f32>(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

fn noise(p : vec3<f32>) -> f32
{
    var i = floor(p);
    var f = fract(p);
    var u = f * f * (3.0 - 2.0 * f);
    
    var a = hash(i + vec3<f32>(0.0, 0.0, 0.0));
    var b = hash(i + vec3<f32>(1.0, 0.0, 0.0));
    var c = hash(i + vec3<f32>(0.0, 1.0, 0.0));
    var d = hash(i + vec3<f32>(1.0, 1.0, 0.0));
    var e = hash(i + vec3<f32>(0.0, 0.0, 1.0));
    var f1 = hash(i + vec3<f32>(1.0, 0.0, 1.0));
    var g = hash(i + vec3<f32>(0.0, 1.0, 1.0));
    var h = hash(i + vec3<f32>(1.0, 1.0, 1.0));
    
    var k0 = mix(a, b, u.x);
    var k1 = mix(c, d, u.x);
    var l0 = mix(k0, k1, u.y);
    
    var k2 = mix(e, f1, u.x);
    var k3 = mix(g, h, u.x);
    var l1 = mix(k2, k3, u.y);
    
    return mix(l0, l1, u.z);
}

fn fbm(p : vec3<f32>) -> f32
{
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 0.0;
    
    for(var i = 0; i < 4; i = i + 1)
    {
        value += amplitude * noise(p);
        p = p * 2.0;
        amplitude *= 0.5;
    }
    
    return value;
}

fn sphere(p: vec3<f32>, spr: vec4<f32>) -> f32
{
  return length(spr.xyz-p) - spr.w;
}

fn flame(p: vec3<f32>) -> f32
{
  var iTime = uniforms.mytimer;
  
  // Base flame shape - elongated sphere
  var d = sphere(p*vec3<f32>(1.2, 0.4, 1.2), vec4<f32>(0.0, -0.8, 0.0, 1.0));
  
  // Add turbulence and movement
  var turbulence = fbm(p * 2.0 + vec3<f32>(iTime * 1.5, iTime * 3.0, iTime * 0.8));
  var wind = fbm(p * 0.5 + vec3<f32>(iTime * 0.3, 0.0, iTime * 0.5));
  
  // Combine effects for more realistic flame
  var noise_effect = (turbulence + wind * 0.3) * 0.15;
  var height_factor = max(0.0, p.y + 1.0) * 0.8; // Stronger effect at top
  
  return d + noise_effect * height_factor;
}

fn scene(p: vec3<f32>) -> f32
{
  return min(100.0-length(p) , abs(flame(p)) );
}

fn raymarch(org: vec3<f32>, dir: vec3<f32>) -> vec4<f32>
{
  var d    = 0.0;
  var glow = 0.0;
  var eps  = 0.005; // Higher precision
  var p    = org;
  var glowed = 0u;
  var max_dist = 10.0;
  var traveled = 0.0;
  
  for(var i=0; i<128; i=i+1) // More steps for better quality
  {
    d = scene(p) + eps;
    p = p + d * dir;
    traveled += d;
    
    if(traveled > max_dist)
    {
      break;
    }
    
    if(d > eps)
    {
      if(flame(p) < 0.0)
      {
        glowed = 1u;
      }

      if(glowed == 1u)
      {
        glow = f32(i)/128.0;
      }
    }
  }
  return vec4<f32>(p, glow);
}


@fragment
fn main(@location(0) uvs    : vec2<f32>) -> @location(0) vec4<f32> 
{
  var v = -1.0 + 2.0 * uvs.xy / 1.0;
  
  var org = vec3<f32>(0., -2., 4.);
  var dir = normalize(vec3<f32>(v.x*1.6, -v.y, -1.5));
  
  var p = raymarch(org, dir);
  var glow = p.w;
  
  // Enhanced color gradient for jetpack flame
  // Inner core: bright white-blue
  // Middle: orange-yellow  
  // Outer: deep blue-purple
  var height_factor = (p.y + 1.5) * 0.4;
  
  var inner_color = vec4<f32>(1.0, 0.9, 0.7, 1.0);  // Bright white-yellow
  var mid_color = vec4<f32>(1.0, 0.4, 0.1, 1.0);    // Orange
  var outer_color = vec4<f32>(0.2, 0.3, 0.8, 1.0);   // Blue-purple
  
  var col = mix(inner_color, mid_color, height_factor);
  col = mix(col, outer_color, height_factor * height_factor);
  
  // Add some flicker variation
  var flicker = fbm(p + uniforms.mytimer * vec3<f32>(2.0, 1.0, 0.5)) * 0.2 + 0.8;
  col = col * flicker;
  
  // Better glow falloff
  var fragColor = mix(vec4<f32>(0.), col, pow(glow * 2.2, 3.5));
    
  fragColor.w = 1.0;
  return fragColor;
}
  
  
  
	 
	 
	 
	 
