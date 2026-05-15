struct VSOut {
    @builtin(position) Position: vec4<f32>,
    @location(0)       uvs     : vec2<f32>,
};

@vertex 
fn main(@builtin(vertex_index) VertexIndex : u32)  -> VSOut 
{
    var s = 0.9; 
    var pos =  array<vec2<f32>, 4>( vec2<f32>( -s,  s ), 
                                    vec2<f32>( -s, -s ), 
                                    vec2<f32>(  s,  s ),
                                    vec2<f32>(  s, -s ));

    s = 1.0;
    var uvs =  array<vec2<f32>, 4>( vec2<f32>( -s,  s ), 
                                    vec2<f32>( -s, -s ), 
                                    vec2<f32>(  s,  s ),
                                    vec2<f32>(  s, -s ));

    
    var vsOut: VSOut;
    vsOut.Position = vec4<f32>(pos[ VertexIndex ], 0.0, 1.0);
    vsOut.uvs      = uvs[ VertexIndex ] * 0.5 + 0.5; // 0->1
    return vsOut;

}
	 
	 
	 
	 
	 
