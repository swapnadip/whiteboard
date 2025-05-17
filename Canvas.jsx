import { Circle as CircleIcon, Eraser, Pencil, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://localhost:4001';

const Canvas = () => {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [eraserWidth, setEraserWidth] = useState(10);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [previewMode, setPreviewMode] = useState(false);
  const isApplyingRemoteAction = useRef(false); // Flag to prevent re-emitting remote actions

  const getCanvasContext = useCallback(() => {
    return canvasRef.current ? canvasRef.current.getContext('2d') : null;
  }, []);

  const applyDrawingAction = useCallback((data, context) => {
    if (!context) context = getCanvasContext();
    if (!context) return;

    context.strokeStyle = data.color || color; // Use action color or current color
    context.fillStyle = data.color || color;   // Use action color or current color
    context.lineWidth = data.lineWidth || (data.tool === 'eraser' ? eraserWidth : lineWidth);
    context.lineCap = 'round';
    context.font = data.font || '16px Arial';

    // Apply globalCompositeOperation for eraser consistently
    const originalCompositeOperation = context.globalCompositeOperation;
    if (data.tool === 'eraser' || (data.type === 'eraser' && data.tool !== 'pen')) { // Ensure eraser type uses destination-out
        context.globalCompositeOperation = 'destination-out';
        // For eraser, lineWidth from data is actually the eraser path width.
        // The 'brush' size is effectively data.lineWidth.
        context.lineWidth = data.lineWidth || eraserWidth;
    }


    if (data.type === 'start') {
      context.beginPath();
      context.moveTo(data.x, data.y);
    } else if (data.type === 'draw') {
      context.lineTo(data.x, data.y);
      context.stroke();
    } else if (data.type === 'stop') {
      context.closePath();
    } else if (data.type === 'rect') {
      context.strokeRect(data.x, data.y, data.width, data.height);
    } else if (data.type === 'circle') {
      context.beginPath();
      context.arc(data.x, data.y, data.radius, 0, 2 * Math.PI);
      context.stroke();
    } else if (data.type === 'text') {
      context.fillText(data.text, data.x, data.y);
    } else if (data.type === 'eraser') {
      // Eraser drawing logic (can be point-by-point or continuous line)
      // If it's a continuous line, it would be part of 'start' and 'draw' with tool='eraser'
      // This specific 'eraser' type implies a single point erase or part of a path
      context.beginPath();
      context.arc(data.x, data.y, (data.lineWidth || eraserWidth) / 2, 0, Math.PI * 2, false);
      context.fill();
    } else if (data.type === 'clear') {
      const canvas = canvasRef.current;
      if (canvas) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    
    if (data.tool === 'eraser' || (data.type === 'eraser' && data.tool !== 'pen')) {
        context.globalCompositeOperation = originalCompositeOperation; // Restore
    }

  }, [getCanvasContext, color, lineWidth, eraserWidth]);


  // Initialize Socket.io connection and event listeners
  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL);

    socketRef.current.on('connect', () => {
      console.log('Connected to socket server:', socketRef.current.id);
    });

    socketRef.current.on('initial-drawing-history', (actions) => {
      console.log('Received initial drawing history:', actions.length, 'actions');
      const context = getCanvasContext();
      const canvas = canvasRef.current;
      if (!context || !canvas) return;

      isApplyingRemoteAction.current = true;
      context.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas before applying history
      actions.forEach(action => {
        applyDrawingAction(action, context);
      });
      isApplyingRemoteAction.current = false;
      saveHistory(); // Save the fully reconstructed state as the initial history point
    });

    socketRef.current.on('drawing-action', (data) => {
      if (socketRef.current.id === data.emitterSocketId) return; // Ignore actions emitted by self if server echoes them (optional server-side optimization)
      
      console.log('Received drawing action:', data);
      isApplyingRemoteAction.current = true;
      applyDrawingAction(data);
      saveHistory(); // Save state after applying remote action
      isApplyingRemoteAction.current = false;
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [getCanvasContext, applyDrawingAction]); // saveHistory removed from here to avoid loops, it's called specifically now

  // Effect for local drawing settings
  useEffect(() => {
    const context = getCanvasContext();
    if (!context) return;
    context.lineCap = 'round';
    context.strokeStyle = color;
    context.lineWidth = tool === 'eraser' ? eraserWidth : lineWidth;
    context.fillStyle = color; 
    context.font = '16px Arial';
  }, [color, lineWidth, eraserWidth, tool, getCanvasContext]);

  // Effect to initialize history if canvas is ready and history is empty
   useEffect(() => {
    if (canvasRef.current && history.length === 0 && getCanvasContext()) {
        // Ensure canvas is sized before saving initial history
        const canvas = canvasRef.current;
        if (canvas.width > 0 && canvas.height > 0) {
             setTimeout(() => { // Ensure context is fully ready
                if (getCanvasContext() && history.length === 0) { // Double check history
                    saveHistory();
                }
            }, 0);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCanvasContext]); // Removed history dependency to avoid loop on initial load


  const saveHistory = useCallback(() => {
    if (!canvasRef.current || !getCanvasContext()) return;
    // if (isApplyingRemoteAction.current) return; // Do not save history if it's due to a remote action that's already being processed

    const canvas = canvasRef.current;
    const dataURL = canvas.toDataURL();
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(dataURL);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);

    // IMPORTANT: We no longer emit 'canvas-state' from here.
    // Individual actions are emitted as they happen.
  }, [history, historyStep, getCanvasContext]);


  const restoreHistory = useCallback(() => {
    if (historyStep < 0 || historyStep >= history.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (!context) return;
    const img = new Image();
    img.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0);
    };
    img.src = history[historyStep];
  }, [history, historyStep, getCanvasContext]);

  const handleUndo = () => {
    if (historyStep > 0) {
      setHistoryStep(prevStep => prevStep - 1);
    }
  };

  const handleRedo = () => {
    if (historyStep < history.length - 1) {
      setHistoryStep(prevStep => prevStep + 1);
    }
  };

  // Effect to restore canvas on undo/redo
  useEffect(() => {
    if (history.length > 0 && historyStep >=0 && historyStep < history.length) {
        restoreHistory();
    }
  }, [historyStep, history, restoreHistory]);


  const handleClear = () => {
    const canvas = canvasRef.current;
    const context = getCanvasContext();
    if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        saveHistory(); // Save the cleared state to local history
        if (socketRef.current) {
            socketRef.current.emit('clear-canvas');
        }
    }
  };

  const getMousePos = (nativeEvent) => {
    if (!canvasRef.current) return {x:0, y:0};
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: nativeEvent.clientX - rect.left,
      y: nativeEvent.clientY - rect.top
    };
  };

  const drawShapePreview = useCallback(() => {
    if (!isDrawing || (tool !== 'rectangle' && tool !== 'circle') || !previewMode) return;
    
    const context = getCanvasContext();
    if (!context || !canvasRef.current) return;
    
    if (historyStep >= 0 && historyStep < history.length) {
      const img = new Image();
      img.onload = () => {
        context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        context.drawImage(img, 0, 0);
        
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        
        if (tool === 'rectangle') {
          const width = currentPos.x - startPos.x;
          const height = currentPos.y - startPos.y;
          context.strokeRect(startPos.x, startPos.y, width, height);
        } else if (tool === 'circle') {
          const radius = Math.sqrt(Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.y - startPos.y, 2));
          context.beginPath();
          context.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
          context.stroke();
        }
      };
      img.src = history[historyStep];
    }
  }, [isDrawing, tool, previewMode, startPos, currentPos, color, lineWidth, getCanvasContext, history, historyStep]);

  useEffect(() => {
    drawShapePreview();
  }, [currentPos, drawShapePreview]);

  const startDrawing = ({ nativeEvent }) => {
    if (isApplyingRemoteAction.current) return;
    const { x, y } = getMousePos(nativeEvent);
    setStartPos({ x, y });
    setCurrentPos({ x, y }); // Initialize currentPos
    const context = getCanvasContext();
    if (!context) return;

    const currentTool = tool; // Capture tool at the start of the action
    const currentLineWidth = currentTool === 'eraser' ? eraserWidth : lineWidth;
    const currentColor = color; // Capture color

    context.strokeStyle = currentColor;
    context.fillStyle = currentColor;
    context.lineWidth = currentLineWidth;

    if (currentTool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        context.font = '16px Arial'; // Ensure font is set
        context.fillText(text, x, y);
        saveHistory();
        if (socketRef.current) {
          socketRef.current.emit('drawing-action', { 
            type: 'text', text, x, y, 
            color: currentColor, 
            lineWidth: currentLineWidth, // Though not directly used for text, send for consistency
            font: context.font,
            tool: currentTool
          });
        }
      }
      return;
    }

    setIsDrawing(true);
    
    if (currentTool === 'pen' || currentTool === 'eraser') {
      context.beginPath();
      context.moveTo(x, y);
      // For eraser, set composite operation at start
      if (currentTool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
      }
      if (socketRef.current) {
        socketRef.current.emit('drawing-action', { 
          type: 'start', x, y, 
          color: currentColor, 
          lineWidth: currentLineWidth,
          tool: currentTool 
        });
      }
    } else if (currentTool === 'rectangle' || currentTool === 'circle') {
      setPreviewMode(true);
    }
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing || isApplyingRemoteAction.current) return;
    
    const { x, y } = getMousePos(nativeEvent);
    setCurrentPos({ x, y }); // Update currentPos for preview and final shape
    
    const context = getCanvasContext();
    if (!context) return;

    const currentTool = tool; // Capture tool
    const currentLineWidth = currentTool === 'eraser' ? eraserWidth : lineWidth;
    const currentColor = color; // Capture color

    // Ensure context settings are correct for the current tool during drawing
    context.strokeStyle = currentColor;
    context.lineWidth = currentLineWidth;
    if (currentTool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
    } else {
        context.globalCompositeOperation = 'source-over'; // Default for pen/shapes
    }


    if (currentTool === 'pen') {
      context.lineTo(x, y);
      context.stroke();
      if (socketRef.current) {
        socketRef.current.emit('drawing-action', { 
            type: 'draw', x, y, 
            color: currentColor, 
            lineWidth: currentLineWidth, 
            tool: currentTool 
        });
      }
    } else if (currentTool === 'eraser') {
      // For eraser, we are drawing a path.
      // The arc method for single points isn't needed here if it's a continuous drag.
      context.lineTo(x, y);
      context.stroke(); // Stroke the eraser path
      if (socketRef.current) {
        socketRef.current.emit('drawing-action', { 
            type: 'draw', // Treat eraser path drawing similar to pen path drawing
            x, y, 
            lineWidth: currentLineWidth, // This is the eraser path width
            tool: currentTool
            // No color needed for eraser path when using destination-out
        });
      }
    }
    // Rectangle and circle previews are handled by drawShapePreview effect
  };

  const stopDrawing = ({ nativeEvent }) => {
    if (isApplyingRemoteAction.current) return;
    // Allow stopDrawing to proceed even if isDrawing is false for shape tools to draw the final shape
    if (!isDrawing && tool !== 'rectangle' && tool !== 'circle') {
        return;
    }

    const { x, y } = getMousePos(nativeEvent); // Use final mouse position
    const context = getCanvasContext();
    if (!context) return;

    const currentTool = tool; // Capture tool
    const currentLineWidth = currentTool === 'eraser' ? eraserWidth : lineWidth;
    const currentColor = color; // Capture color


    if (currentTool === 'pen' || currentTool === 'eraser') {
      context.closePath();
      if (currentTool === 'eraser') {
        context.globalCompositeOperation = 'source-over'; // Reset composite operation
      }
      if (socketRef.current) {
        socketRef.current.emit('drawing-action', { 
            type: 'stop', 
            tool: currentTool 
        });
      }
    } else if (currentTool === 'rectangle') {
      const rectWidth = x - startPos.x;
      const rectHeight = y - startPos.y;
      
      // Draw final rectangle on current context (preview might be slightly off)
      context.strokeStyle = currentColor; // Ensure correct color and linewidth for final draw
      context.lineWidth = currentLineWidth;
      context.strokeRect(startPos.x, startPos.y, rectWidth, rectHeight);
      
      if (socketRef.current) {
        socketRef.current.emit('drawing-action', { 
          type: 'rect', 
          x: startPos.x, y: startPos.y, 
          width: rectWidth, height: rectHeight, 
          color: currentColor, 
          lineWidth: currentLineWidth,
          tool: currentTool
        });
      }
    } else if (currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(x - startPos.x, 2) + Math.pow(y - startPos.y, 2));
      
      context.strokeStyle = currentColor;
      context.lineWidth = currentLineWidth;
      context.beginPath();
      context.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
      context.stroke();
      
      if (socketRef.current) {
        socketRef.current.emit('drawing-action', { 
          type: 'circle', 
          x: startPos.x, y: startPos.y, 
          radius, 
          color: currentColor, 
          lineWidth: currentLineWidth,
          tool: currentTool
        });
      }
    }
    
    setPreviewMode(false);
    saveHistory(); // Save state after local action is completed
    setIsDrawing(false);
  };

  const getCursorStyle = () => {
    switch(tool) {
      case 'pen': return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>') 0 24, auto`;
      case 'eraser': return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>') 0 24, auto`;
      case 'text': return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>') 0 24, auto`;
      case 'rectangle': return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>') 0 24, auto`;
      case 'circle': return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>') 0 24, auto`;
      default: return 'crosshair';
    }
  };

  const iconSize = 20;
  const baseButtonStyle = { margin: '5px', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' };
  const activeButtonStyle = { ...baseButtonStyle, backgroundColor: '#e0e0e0', borderColor: '#999', boxShadow: 'inset 0 3px 5px rgba(0,0,0,0.125)' };
  const getButtonStyle = (buttonTool) => (tool === buttonTool && !['undo', 'redo', 'clear'].includes(buttonTool)) ? activeButtonStyle : baseButtonStyle;

  return (
    <div>
      <div style={{ marginBottom: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Tool Buttons */}
        <button style={getButtonStyle('pen')} onClick={() => setTool('pen')} title="Pen"><Pencil size={iconSize} /></button>
        <button style={getButtonStyle('eraser')} onClick={() => setTool('eraser')} title="Eraser"><Eraser size={iconSize} /></button>
        <button style={getButtonStyle('text')} onClick={() => setTool('text')} title="Text"><Type size={iconSize} /></button>
        <button style={getButtonStyle('rectangle')} onClick={() => setTool('rectangle')} title="Rectangle"><Square size={iconSize} /></button>
        <button style={getButtonStyle('circle')} onClick={() => setTool('circle')} title="Circle"><CircleIcon size={iconSize} /></button>
        
        {/* Color Picker */}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ marginLeft: '10px', height: '38px' }} title="Color Picker"/>
        
        {/* Line Width Slider */}
        <label htmlFor="lineWidth" style={{ marginLeft: '10px', marginRight: '5px' }}>Line:</label>
        <input type="range" id="lineWidth" min="1" max="50" value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} title="Line Width"/>
        <span style={{width: '25px', textAlign:'right'}}>{lineWidth}</span>

        {/* Eraser Width Slider */}
        <label htmlFor="eraserWidth" style={{ marginLeft: '10px', marginRight: '5px' }}>Eraser:</label>
        <input type="range" id="eraserWidth" min="1" max="100" value={eraserWidth} onChange={(e) => setEraserWidth(Number(e.target.value))} title="Eraser Width"/>
        <span style={{width: '25px', textAlign:'right'}}>{eraserWidth}</span>

        {/* Action Buttons */}
        <button style={getButtonStyle('undo')} onClick={handleUndo} disabled={historyStep <= 0} title="Undo"><Undo2 size={iconSize} /></button>
        <button style={getButtonStyle('redo')} onClick={handleRedo} disabled={historyStep >= history.length - 1} title="Redo"><Redo2 size={iconSize} /></button>
        <button style={getButtonStyle('clear')} onClick={handleClear} title="Clear Canvas"><Trash2 size={iconSize} /></button>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseOut={stopDrawing} // Stop drawing if mouse leaves canvas
        width={800} // It's better to set initial size, can be dynamic too
        height={600}
        style={{ border: '1px solid #000', touchAction: 'none', cursor: getCursorStyle() }}
      />
    </div>
  );
};

export default Canvas;