const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const port = process.env.PORT || 4001;

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity in development
    methods: ["GET", "POST"]
  }
});

let drawingActionsHistory = []; // Store a history of drawing actions/commands

const MAX_HISTORY_LENGTH = 200; // Limit the number of actions stored

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Send the existing drawing history to the new client
  if (drawingActionsHistory.length > 0) {
    socket.emit("initial-drawing-history", drawingActionsHistory);
  }

  socket.on("drawing-action", (data) => {
    // Add action to history
    drawingActionsHistory.push(data);
    if (drawingActionsHistory.length > MAX_HISTORY_LENGTH) {
      drawingActionsHistory.shift(); // Keep history manageable
    }
    // Broadcast the drawing action to all other clients
    socket.broadcast.emit("drawing-action", data);
  });

  socket.on("clear-canvas", () => {
    const clearAction = { type: "clear" };
    drawingActionsHistory.push(clearAction);
    if (drawingActionsHistory.length > MAX_HISTORY_LENGTH) {
        drawingActionsHistory.shift();
    }
    // If you want to completely reset history on clear:
    // drawingActionsHistory = [clearAction]; 
    
    socket.broadcast.emit("drawing-action", clearAction); // Send as a drawing action
    console.log("Canvas cleared and clear action broadcasted");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(port, () => console.log(`Listening on port ${port}`));