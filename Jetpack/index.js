/*
  WebGPU - Flame
  e.g. simple shader flame/fire effect
*/


var script = document.createElement('script');
script.type  = 'text/javascript';
script.async = false;
script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.6.0/gl-matrix-min.js';
document.head.appendChild(script); 


const canvas = document.createElement('canvas');
document.body.appendChild( canvas );
canvas.width  = canvas.height = 512;
console.log( canvas.width, canvas.height );
const context = canvas.getContext('webgpu');

const gpu = navigator.gpu;
console.log( 'gpu:', gpu );

const adapter = await gpu.requestAdapter();
const device  = await adapter.requestDevice();

const devicePixelRatio = 1 || 1;
const presentationSize = [ canvas.clientWidth * devicePixelRatio,
                           canvas.clientHeight * devicePixelRatio  ];
const presentationFormat = navigator.gpu.getPreferredCanvasFormat(); // context.getPreferredFormat(adapter); - no longer supported
console.log( presentationFormat  );

context.configure({ device: device,
                    format: presentationFormat,
                    size  : presentationSize });


var vertWGSL = document.getElementById('vs.wgsl').innerHTML;
var fragWGSL = document.getElementById('fs.wgsl').innerHTML;

// ----------------------------------------------------------------

let textureSampler = device.createSampler({
     minFilter: "linear",
     magFilter: "linear"
});

const img = document.createElement("img");
img.src = 'https://webgpulab.xbdev.net/var/images/test512.png';
await img.decode();

const basicTexture = device.createTexture({
    size: [img.width, img.height, 1],
    format: presentationFormat , // "bgra8unorm", // "rgba8unorm",
    usage: 0x2 | 0x4 // GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
});

const imageCanvas = document.createElement('canvas');
imageCanvas.width =  img.width;
imageCanvas.height = img.height;
const imageCanvasContext = imageCanvas.getContext('2d');
imageCanvasContext.drawImage(img, 0, 0, imageCanvas.width, imageCanvas.height);
const imageData = imageCanvasContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
let textureData= new Uint8Array( img.width * img.height * 4);
for (let x=0; x<img.width * img.height * 4; x++)
{
   textureData[ x ] = imageData.data[ x ];
}

device.queue.writeTexture( { texture: basicTexture },
            textureData,
            {   offset     :  0,
                bytesPerRow:  img.width * 4,
                rowsPerImage: img.height
             },
            [ img.width  ,  img.height,  1  ]   );

// ----------------------------------------------------------------

const timerUniformBuffer = device.createBuffer({
  size: 4, 
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const timestep  = new Float32Array( [3.14] );

device.queue.writeBuffer(timerUniformBuffer,   0, timestep             );

// ----------------------------------------------------------------

const sceneUniformBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering"  } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float",
                                                                  viewDimension: "2d"} },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer : { type: "uniform"    } }
  ]
});

const uniformBindGroup = device.createBindGroup({
  layout:   sceneUniformBindGroupLayout,
  entries: [
    { binding : 0, resource: textureSampler                },
    { binding : 1, resource: basicTexture.createView()     },
    { binding : 2, resource: { buffer: timerUniformBuffer} }
   ]
});

// ----------------------------------------------------------------


const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({bindGroupLayouts: [sceneUniformBindGroupLayout]}),
    vertex:   {  module    : device.createShaderModule({ 
                             code : vertWGSL }),
                 entryPoint: 'main'
              },
    fragment: {  module    : device.createShaderModule({ 
                             code : fragWGSL,     }),
                 entryPoint: 'main',
                 targets: [{  format : presentationFormat  }] },
    primitive: { topology  : 'triangle-strip',
                 frontFace : "ccw",
//                 cullMode  : 'back',
                 stripIndexFormat: 'uint32' }
                 
});

// GPURenderPassDescriptor 
const renderPassDescriptor = { 
           colorAttachments:  [{    
           view     : undefined, // asign later in frame
           loadOp:"clear", clearValue: { r: 0.0, g: 0.5, b: 0.5, a: 1.0 },
           storeOp  : 'store' }]
};


function frame() {
    timestep[0] += 0.01;
    device.queue.writeBuffer(timerUniformBuffer,   0, timestep );
    // -------
    renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

    const commandEncoder = device.createCommandEncoder();

    const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, uniformBindGroup);
    renderPass.draw(4, 1, 0, 0);

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    // if you want constant updates (animated) - keep refreshing
    requestAnimationFrame(frame);
};
frame();

console.log('burn baby burn! effect');
                          
	 
	 
	 
	 
