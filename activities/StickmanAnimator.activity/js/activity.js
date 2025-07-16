define([
	"sugar-web/activity/activity",
	"activity/palettes/speedpalette",
	"activity/palettes/templatepalette",
], function (
	activity,
	speedpalette,
	templatepalette
) {
	// Manipulate the DOM only when it is ready.
	requirejs(['domReady!'], function (doc) {

		// STATE VARIABLES
		let canvas, ctx;
		let frames = [];
		let currentFrame = 0;
		let isPlaying = false;
		let speed = 1;
		let joints = [];
		let selectedJoint = null;
		let isDragging = false;
		let isDraggingWhole = false;
		let templates = {};
		let currentSpeed = 1;
		let dragStartPos = { x: 0, y: 0 };
		let originalJoints = [];
		let lastFrameTime = 0;
		let frameRecordingInterval = 100; // milliseconds between frame captures
		let dragStartFrame = -1;

		// Joint connections with proper distances
		const jointConnections = [
			{ from: 0, to: 1, length: 15 },    // head to body 
			{ from: 1, to: 11, length: 25 },   // body to middle
			{ from: 11, to: 2, length: 25 },   // middle to hips
			{ from: 2, to: 3, length: 35 },    // hips to left knee
			{ from: 3, to: 4, length: 35 },    // left knee to foot
			{ from: 2, to: 5, length: 35 },    // hips to right knee
			{ from: 5, to: 6, length: 35 },    // right knee to foot
			{ from: 1, to: 7, length: 35 },    // body to left elbow
			{ from: 7, to: 8, length: 25 },    // left elbow to hand
			{ from: 1, to: 9, length: 35 },    // body to right elbow
			{ from: 9, to: 10, length: 25 }    // right elbow to hand
		];

		// INITIALIZATION FUNCTIONS

		function initializeAnimator() {
			const canvasElement = document.getElementById('stickman-canvas');
			if (canvasElement) {
				initCanvas();
				initEvents();
				initControls();
				createDefaultStickman();
				addFrame();
				render();
			} else {
				console.warn('Canvas element not found, retrying...');
				setTimeout(initializeAnimator, 100);
			}
		}

		function initCanvas() {
			canvas = document.getElementById('stickman-canvas');
			ctx = canvas.getContext('2d');
			resizeCanvas();
			window.addEventListener('resize', resizeCanvas);
		}

		function resizeCanvas() {
			canvas.width = canvas.parentElement.clientWidth - 32;
			canvas.height = canvas.parentElement.clientHeight - 200;
		}

		function initEvents() {
			canvas.addEventListener('mousedown', handleMouseDown);
			canvas.addEventListener('mousemove', handleMouseMove);
			canvas.addEventListener('mouseup', handleMouseUp);

			// Control buttons
			document.getElementById('add-button').addEventListener('click', addFrame);
			document.getElementById('export-button').addEventListener('click', exportAnimation);
			document.getElementById('addStickman-button').addEventListener('click', createNew);
			document.getElementById('stop-button').addEventListener('click', function () {
				pause();
				activity.close();
			});
		}

		function initControls() {

			// Play/Pause button setup
			const playPauseButton = document.getElementById('play-pause-button');
			playPauseButton.style.backgroundImage = "url('icons/play.svg')";
			playPauseButton.style.backgroundPosition = "center";
			playPauseButton.style.backgroundRepeat = "no-repeat";
			playPauseButton.style.backgroundSize = "contain";
			playPauseButton.addEventListener('click', togglePlayPause);

			// Speed control setup
			const speedButton = document.getElementById("speed-button");
			const speedPalette = new speedpalette.SpeedPalette(speedButton);
			speedPalette.addEventListener('speed', function (e) {
				currentSpeed = e.detail.speed;
				speed = currentSpeed;
				console.log("Speed set to:", currentSpeed.toFixed(2) + "x");
			});

			// Template palette
			var templateButton = document.getElementById("template-button");
			var templatePalette = new templatepalette.TemplatePalette(templateButton);

			document.addEventListener('template-selected', function (e) {
				loadTemplate(e.detail.template);
			});
		}

		// STICKMAN CREATION & TEMPLATES


		function createDefaultStickman() {
			// Calculate center of canvas
			const centerX = canvas.width / 2;
			const centerY = canvas.height / 2;

			// Define stickman relative to center position
			joints = [
				{ x: centerX, y: centerY - 50, name: 'head' },            // 0 - head
				{ x: centerX, y: centerY - 35, name: 'body' },            // 1 - body
				{ x: centerX, y: centerY + 20, name: 'hips' },            // 2 - hips
				{ x: centerX - 15, y: centerY + 50, name: 'leftKnee' },   // 3 - left knee
				{ x: centerX - 20, y: centerY + 80, name: 'leftFoot' },   // 4 - left foot
				{ x: centerX + 15, y: centerY + 50, name: 'rightKnee' },  // 5 - right knee
				{ x: centerX + 20, y: centerY + 80, name: 'rightFoot' },  // 6 - right foot
				{ x: centerX - 25, y: centerY - 25, name: 'leftElbow' },  // 7 - left elbow
				{ x: centerX - 40, y: centerY, name: 'leftHand' },        // 8 - left hand
				{ x: centerX + 25, y: centerY - 25, name: 'rightElbow' }, // 9 - right elbow
				{ x: centerX + 40, y: centerY, name: 'rightHand' },       // 10 - right hand
				{ x: centerX, y: centerY - 8, name: 'middle' }            // 11 - middle (drag joint)
			];

			updateMiddleJoint();
		}

		function updateMiddleJoint() {
			joints[11].x = (joints[1].x + joints[2].x) / 2;
			joints[11].y = (joints[1].y + joints[2].y) / 2;
		}

		async function loadTemplate(templateName) {
			try {
				const response = await fetch(`js/templates/${templateName}.json`);
				if (!response.ok) {
					throw new Error(`Failed to load template: ${templateName}`);
				}
				const templateData = await response.json();

				frames = JSON.parse(JSON.stringify(templateData.frames));
				frames.forEach(frame => {
					if (frame.length === 11) {
						frame.push({ 
							x: (frame[1].x + frame[2].x) / 2, 
							y: (frame[1].y + frame[2].y) / 2, 
							name: 'middle' 
						});
					}
				});

				currentFrame = 0;
				joints = JSON.parse(JSON.stringify(frames[currentFrame]));
				updateMiddleJoint();
				updateTimeline();
			} catch (error) {
				console.error('Error loading template:', error);
				createDefaultStickman();
				addFrame();
			}
		}

		// FRAME MANAGEMENT

		function addFrame() {
			updateMiddleJoint();
			const frameData = JSON.parse(JSON.stringify(joints));
			frames.push(frameData);
			currentFrame = frames.length - 1;
			updateTimeline();
		}

		function saveCurrentFrame() {
			if (currentFrame >= 0) {
				updateMiddleJoint();
				frames[currentFrame] = JSON.parse(JSON.stringify(joints));
			}
		}

		function createNew() {
			frames = [];
			currentFrame = 0;
			createDefaultStickman();
			addFrame();
			updateTimeline();
			pause();
		}

		// TIMELINE FUNCTIONS

		function updateTimeline() {
			const timeline = document.getElementById('timeline');
			timeline.innerHTML = '';

			frames.forEach((frame, index) => {
				const frameContainer = document.createElement('div');
				frameContainer.className = 'frame-container';

				const previewCanvas = createPreviewCanvas(frame, index);
				const deleteBtn = createDeleteButton(index);

				previewCanvas.addEventListener('click', () => {
					currentFrame = index;
					joints = JSON.parse(JSON.stringify(frame));
					updateMiddleJoint();
					updateTimeline(); 
					render();
				});

				frameContainer.appendChild(previewCanvas);
				frameContainer.appendChild(deleteBtn);
				timeline.appendChild(frameContainer);
			});

			// Auto-scroll to active frame if it's not visible
			scrollToActiveFrame();
		}

		function scrollToActiveFrame() {
			const timeline = document.getElementById('timeline');
			const activeFrame = timeline.querySelector('.frame.active');

			if (activeFrame) {
				const timelineRect = timeline.getBoundingClientRect();
				const activeFrameRect = activeFrame.getBoundingClientRect();

				if (activeFrameRect.right > timelineRect.right || activeFrameRect.left < timelineRect.left) {
					activeFrame.scrollIntoView({
						behavior: 'smooth',
						block: 'nearest',
						inline: 'center'
					});
				}
			}
		}

		function createPreviewCanvas(frame, index) {
			const previewCanvas = document.createElement('canvas');
			previewCanvas.width = 80;
			previewCanvas.height = 80;

			// active class for current frame
			const isActive = index === currentFrame;
			previewCanvas.className = `frame ${isActive ? 'active' : ''}`;

			const previewCtx = previewCanvas.getContext('2d');

			// different background colors for active frame
			previewCtx.fillStyle = isActive ? '#e6f3ff' : '#ffffff';
			previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

			const stickmanHeight = Math.max(...frame.map(p => p.y)) - Math.min(...frame.map(p => p.y));
			const stickmanWidth = Math.max(...frame.map(p => p.x)) - Math.min(...frame.map(p => p.x));
			const scale = Math.min(40 / stickmanHeight, 40 / stickmanWidth);

			const centerX = (Math.max(...frame.map(p => p.x)) + Math.min(...frame.map(p => p.x))) / 2;
			const centerY = (Math.max(...frame.map(p => p.y)) + Math.min(...frame.map(p => p.y))) / 2;

			previewCtx.save();
			previewCtx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
			previewCtx.scale(scale, scale);
			previewCtx.translate(-centerX, -centerY);

			drawStickmanPreview(previewCtx, frame);
			previewCtx.restore();

			return previewCanvas;
		}

		function createDeleteButton(index) {
			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'delete-frame';
			deleteBtn.innerHTML = '';
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (frames.length > 1) {
					frames.splice(index, 1);
					currentFrame = Math.min(currentFrame, frames.length - 1);
					updateTimeline();
				}
			});
			return deleteBtn;
		}

		// DRAWING FUNCTIONS

		function drawStickmanPreview(ctx, frame) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			drawStickmanSkeleton(ctx, frame);

			ctx.fillStyle = '#ff0000';
			frame.forEach((joint, index) => {
				if (index === 11) return; // Skip middle joint in preview
				ctx.beginPath();
				if (index === 0) {
					ctx.arc(joint.x, joint.y, 3, 0, Math.PI * 2); 
				} else {
					ctx.arc(joint.x, joint.y, 2, 0, Math.PI * 2); 
				}
				ctx.fill();
			});
		}

		function drawStickman() {
			// draw skeleton first
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			drawStickmanSkeleton(ctx, joints);

			// Draw joints on top
			joints.forEach((joint, index) => {
				// skip middle joint for normal display
				if (index === 11) return;

				ctx.fillStyle = '#ff0000';
				ctx.strokeStyle = '#cc0000';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
				
			});

			// Draw middle joint (drag joint)
			const middleJoint = joints[11];
			ctx.fillStyle = '#00ff00';
			ctx.strokeStyle = '#00cc00';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(middleJoint.x, middleJoint.y, 5, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();

			// highlight selected joint
			if (selectedJoint && selectedJoint !== joints[11]) {
				ctx.strokeStyle = '#ffff00';
				ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(selectedJoint.x, selectedJoint.y, 8, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}

		function drawStickmanSkeleton(ctx, frame) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 10;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// draw body line (head to body to middle to hips)
			ctx.beginPath();
			ctx.moveTo(frame[0].x, frame[0].y);
			ctx.lineTo(frame[1].x, frame[1].y);
			if (frame[11]) {
				ctx.lineTo(frame[11].x, frame[11].y);
			}
			ctx.lineTo(frame[2].x, frame[2].y);
			ctx.stroke();

			// draw left leg
			ctx.beginPath();
			ctx.moveTo(frame[2].x, frame[2].y); // hips
			ctx.lineTo(frame[3].x, frame[3].y); // left knee
			ctx.lineTo(frame[4].x, frame[4].y); // left foot
			ctx.stroke();

			// draw right leg
			ctx.beginPath();
			ctx.moveTo(frame[2].x, frame[2].y); // hips
			ctx.lineTo(frame[5].x, frame[5].y); // right knee
			ctx.lineTo(frame[6].x, frame[6].y); // right foot
			ctx.stroke();

			// draw left arm
			ctx.beginPath();
			ctx.moveTo(frame[1].x, frame[1].y); // body
			ctx.lineTo(frame[7].x, frame[7].y); // left elbow
			ctx.lineTo(frame[8].x, frame[8].y); // left hand
			ctx.stroke();

			// draw right arm
			ctx.beginPath();
			ctx.moveTo(frame[1].x, frame[1].y);    // body
			ctx.lineTo(frame[9].x, frame[9].y);    // right elbow
			ctx.lineTo(frame[10].x, frame[10].y);  // right hand
			ctx.stroke();

			// draw head circle (solid black)
			ctx.beginPath();
			ctx.arc(frame[0].x, frame[0].y, 15, 0, Math.PI * 2);
			ctx.fillStyle = '#000000'; 
			ctx.fill();

		}

		function maintainJointDistances(movedJointIndex) {
			// Skip distance maintenance for middle joint 
			if (movedJointIndex === 11) return;

			// Get all connections for this joint
			const connections = jointConnections.filter(conn =>
				conn.from === movedJointIndex || conn.to === movedJointIndex
			);

			connections.forEach(conn => {
				const otherJointIndex = conn.from === movedJointIndex ? conn.to : conn.from;

				// Skip if other joint is the middle joint (it will be recalculated)
				if (otherJointIndex === 11) return;

				const movedJoint = joints[movedJointIndex];
				const otherJoint = joints[otherJointIndex];

				// Calculate current distance
				const dx = movedJoint.x - otherJoint.x;
				const dy = movedJoint.y - otherJoint.y;
				const currentDistance = Math.sqrt(dx * dx + dy * dy);

				if (Math.abs(currentDistance - conn.length) > 1.0) {
					// Adjust the connected joint to maintain the proper distance
					const ratio = conn.length / currentDistance;
					const targetX = otherJoint.x + dx * ratio;
					const targetY = otherJoint.y + dy * ratio;

					// Move the moved joint to the correct position
					movedJoint.x = targetX;
					movedJoint.y = targetY;
				}
			});
		}

		// ANIMATION CONTROL

		function togglePlayPause() {
			if (isPlaying) {
				pause();
			} else {
				play();
			}
		}

		function play() {
			if (!isPlaying) {
				isPlaying = true;
				document.getElementById('play-pause-button').style.backgroundImage = "url('icons/pause.svg')";
				animate();
			}
		}

		function pause() {
			isPlaying = false;
			document.getElementById('play-pause-button').style.backgroundImage = "url('icons/play.svg')";
		}

		function animate() {
			if (!isPlaying) return;

			currentFrame = (currentFrame + 1) % frames.length;
			joints = JSON.parse(JSON.stringify(frames[currentFrame]));
			updateMiddleJoint();
			updateTimeline();

			setTimeout(() => {
				requestAnimationFrame(animate);
			}, 1000 / (currentSpeed * 2));
		}

		// MOUSE INTERACTION

		function handleMouseDown(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);
			selectedJoint = findJointAtPosition(mouseX, mouseY);

			if (selectedJoint === joints[11]) {
				// Clicked on middle joint - start whole stickman drag
				isDraggingWhole = true;
				dragStartPos = { x: mouseX, y: mouseY };
				originalJoints = JSON.parse(JSON.stringify(joints));
			} else {
				// Normal joint dragging
				isDragging = !!selectedJoint;
			}
		}

		function handleMouseMove(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);

			if (isDraggingWhole) {
				// Drag entire stickman
				const deltaX = mouseX - dragStartPos.x;
				const deltaY = mouseY - dragStartPos.y;

				joints.forEach((joint, index) => {
					joint.x = originalJoints[index].x + deltaX;
					joint.y = originalJoints[index].y + deltaY;
				});

				saveCurrentFrame();
				updateTimeline(); // Add this line to update timeline immediately
			} else if (isDragging && selectedJoint && selectedJoint !== joints[11]) {
				// Find the index of the selected joint
				const selectedIndex = joints.indexOf(selectedJoint);

				selectedJoint.x = mouseX;
				selectedJoint.y = mouseY;

				// Maintain distances only for the moved joint
				maintainJointDistances(selectedIndex);

				// Update middle joint position if body or hips moved
				if (selectedIndex === 1 || selectedIndex === 2) {
					updateMiddleJoint();
				}

				saveCurrentFrame();
				updateTimeline(); // Add this line to update timeline immediately
			}
		}

		function handleMouseUp() {
			isDragging = false;
			isDraggingWhole = false;
			selectedJoint = null;
			// Final update when dragging ends
			if (currentFrame >= 0) {
				saveCurrentFrame();
				updateTimeline();
			}
		}

		function getCanvasCoordinates(e) {
			const rect = canvas.getBoundingClientRect();
			const scaleX = canvas.width / rect.width;
			const scaleY = canvas.height / rect.height;
			return {
				mouseX: (e.clientX - rect.left) * scaleX,
				mouseY: (e.clientY - rect.top) * scaleY
			};
		}

		function findJointAtPosition(x, y) {
			const middleJoint = joints[11];
			if (middleJoint) {
				const dx = middleJoint.x - x;
				const dy = middleJoint.y - y;
				const distance = Math.sqrt(dx * dx + dy * dy);
				if (distance < 8) { 
					return middleJoint;
				}
			}

			for (let i = joints.length - 2; i >= 0; i--) {
				const joint = joints[i];
				const dx = joint.x - x;
				const dy = joint.y - y;
				const distance = Math.sqrt(dx * dx + dy * dy);

				const hitRadius = i === 0 ? 12 : 8; // Head has larger hit area

				if (distance < hitRadius) {
					return joint;
				}
			}
			return null;
		}

		// RENDERING LOOP

		function render() {
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Draw onion skin of previous frame
			if (frames.length > 1 && !isPlaying) {
				const prevFrameIndex = currentFrame === 0 ? frames.length - 1 : currentFrame - 1;
				ctx.save();
				ctx.globalAlpha = 0.3;
				ctx.strokeStyle = '#0066cc';
				ctx.lineWidth = 2;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';

				drawStickmanSkeleton(ctx, frames[prevFrameIndex]);

				ctx.fillStyle = '#0066cc';
				frames[prevFrameIndex].forEach((joint, index) => {

					// Skip middle joint
					if (index === 11) 
						return; 

					ctx.beginPath();
					if (index === 0) {
						ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
					} else {
						ctx.arc(joint.x, joint.y, 2, 0, Math.PI * 2);
					}

					ctx.fill();
				});

				ctx.restore();
			}

			drawStickman();
			requestAnimationFrame(render);
		}

		// EXPORT FUNCTIONALITY

		function exportAnimation() {
			const recordCanvas = document.createElement('canvas');
			recordCanvas.width = canvas.width;
			recordCanvas.height = canvas.height;
			const recordCtx = recordCanvas.getContext('2d');

			const stream = recordCanvas.captureStream(15);
			const mediaRecorder = new MediaRecorder(stream, {
				mimeType: 'video/webm;codecs=vp9'
			});

			const chunks = [];
			mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
			mediaRecorder.onstop = () => {
				const blob = new Blob(chunks, { type: 'video/webm' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'stickman-animation.webm';
				a.click();
				URL.revokeObjectURL(url);
			};

			mediaRecorder.start();

			let currentExportFrame = 0;
			const renderFrame = () => {
				if (currentExportFrame >= frames.length) {
					mediaRecorder.stop();
					return;
				}

				recordCtx.fillStyle = '#ffffff';
				recordCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);

				const originalJoints = [...joints];
				joints = JSON.parse(JSON.stringify(frames[currentExportFrame]));

				// Draw frame
				recordCtx.strokeStyle = '#000';
				recordCtx.lineWidth = 4;
				drawStickmanSkeleton(recordCtx, joints);

				joints = originalJoints;
				currentExportFrame++;
				setTimeout(() => requestAnimationFrame(renderFrame), 150);
			};

			renderFrame();
		}

		// START APPLICATION
		
		activity.setup();
		initializeAnimator();
	});
});