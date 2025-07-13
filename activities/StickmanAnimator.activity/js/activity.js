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

		// Joint constraints for maintaining body proportions (removed to fix body)
		// We'll only use constraints when dragging the whole stickman
		const proportionConstraints = [
			{ joint1: 0, joint2: 1, distance: 30 },    // head to body
			{ joint1: 1, joint2: 11, distance: 20 },   // body to middle
			{ joint1: 11, joint2: 2, distance: 20 },   // middle to hips
			{ joint1: 2, joint2: 3, distance: 35 },    // hips to left knee
			{ joint1: 3, joint2: 4, distance: 35 },    // left knee to foot
			{ joint1: 2, joint2: 5, distance: 35 },    // hips to right knee
			{ joint1: 5, joint2: 6, distance: 35 },    // right knee to foot
			{ joint1: 1, joint2: 7, distance: 35 },    // body to left elbow
			{ joint1: 7, joint2: 8, distance: 25 },    // left elbow to hand
			{ joint1: 1, joint2: 9, distance: 35 },    // body to right elbow
			{ joint1: 9, joint2: 10, distance: 25 }    // right elbow to hand
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
			// Canvas events
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
			joints = [
				{ x: 200, y: 150, name: 'head' },      // 0 - head
				{ x: 200, y: 180, name: 'body' },      // 1 - body (shoulders)
				{ x: 200, y: 220, name: 'hips' },      // 2 - hips
				{ x: 185, y: 250, name: 'leftKnee' },  // 3 - left knee
				{ x: 180, y: 280, name: 'leftFoot' },  // 4 - left foot
				{ x: 215, y: 250, name: 'rightKnee' }, // 5 - right knee
				{ x: 220, y: 280, name: 'rightFoot' }, // 6 - right foot
				{ x: 175, y: 190, name: 'leftElbow' }, // 7 - left elbow
				{ x: 160, y: 210, name: 'leftHand' },  // 8 - left hand
				{ x: 225, y: 190, name: 'rightElbow' },// 9 - right elbow
				{ x: 240, y: 210, name: 'rightHand' }, // 10 - right hand
				{ x: 200, y: 200, name: 'middle' }     // 11 - middle (drag joint)
			];
		}

		async function loadTemplate(templateName) {
			try {
				const response = await fetch(`js/templates/${templateName}.json`);
				if (!response.ok) {
					throw new Error(`Failed to load template: ${templateName}`);
				}
				const templateData = await response.json();

				frames = JSON.parse(JSON.stringify(templateData.frames));
				// Add middle joint to existing templates if not present
				frames.forEach(frame => {
					if (frame.length === 11) {
						frame.push({ x: (frame[1].x + frame[2].x) / 2, y: (frame[1].y + frame[2].y) / 2, name: 'middle' });
					}
				});

				currentFrame = 0;
				joints = JSON.parse(JSON.stringify(frames[currentFrame]));
				updateTimeline();
			} catch (error) {
				console.error('Error loading template:', error);
				createDefaultStickman();
				addFrame();
			}
		}

		// FRAME MANAGEMENT

		function addFrame() {
			const frameData = JSON.parse(JSON.stringify(joints));
			frames.push(frameData);
			currentFrame = frames.length - 1;
			updateTimeline();
		}

		function saveCurrentFrame() {
			if (currentFrame >= 0) {
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
					updateTimeline();
				});

				frameContainer.appendChild(previewCanvas);
				frameContainer.appendChild(deleteBtn);
				timeline.appendChild(frameContainer);
			});
		}

		function createPreviewCanvas(frame, index) {
			const previewCanvas = document.createElement('canvas');
			previewCanvas.width = 60;
			previewCanvas.height = 60;
			previewCanvas.className = `frame ${index === currentFrame ? 'active' : ''}`;

			const previewCtx = previewCanvas.getContext('2d');
			previewCtx.fillStyle = '#ffffff';
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
			// Simplified version for timeline previews
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			drawStickmanSkeleton(ctx, frame);

			// Draw small red joints for preview (excluding middle joint)
			ctx.fillStyle = '#ff0000';
			frame.forEach((joint, index) => {
				if (index === 11) return; // Skip middle joint in preview
				ctx.beginPath();
				if (index === 0) {
					ctx.arc(joint.x, joint.y, 3, 0, Math.PI * 2); // Head slightly larger
				} else {
					ctx.arc(joint.x, joint.y, 2, 0, Math.PI * 2); // Body joints
				}
				ctx.fill();
			});
		}

		function drawStickman() {
			// Draw skeleton first (behind joints)
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			drawStickmanSkeleton(ctx, joints);

			// Draw joints on top (Pivot style - red circles)
			joints.forEach((joint, index) => {
				// Skip middle joint for normal display
				if (index === 11) return;

				// Different colors for different joint types
				if (index === 0) {
					// Head joint - slightly larger
					ctx.fillStyle = '#ff0000';
					ctx.strokeStyle = '#cc0000';
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.arc(joint.x, joint.y, 6, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				} else {
					// Body joints
					ctx.fillStyle = '#ff0000';
					ctx.strokeStyle = '#cc0000';
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				}
			});

			// Draw middle joint (drag joint) with different style
			const middleJoint = joints[11];
			ctx.fillStyle = '#00ff00';
			ctx.strokeStyle = '#00cc00';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(middleJoint.x, middleJoint.y, 8, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();

			// Add cross pattern to indicate drag functionality
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(middleJoint.x - 4, middleJoint.y);
			ctx.lineTo(middleJoint.x + 4, middleJoint.y);
			ctx.moveTo(middleJoint.x, middleJoint.y - 4);
			ctx.lineTo(middleJoint.x, middleJoint.y + 4);
			ctx.stroke();

			// Highlight selected joint
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
			ctx.lineWidth = 8;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// Draw body line (head to body to middle to hips)
			ctx.beginPath();
			ctx.moveTo(frame[0].x, frame[0].y);
			ctx.lineTo(frame[1].x, frame[1].y);
			if (frame[11]) {
				ctx.lineTo(frame[11].x, frame[11].y);
			}
			ctx.lineTo(frame[2].x, frame[2].y);
			ctx.stroke();

			// Draw left leg
			ctx.beginPath();
			ctx.moveTo(frame[2].x, frame[2].y); // hips
			ctx.lineTo(frame[3].x, frame[3].y); // left knee
			ctx.lineTo(frame[4].x, frame[4].y); // left foot
			ctx.stroke();

			// Draw right leg
			ctx.beginPath();
			ctx.moveTo(frame[2].x, frame[2].y); // hips
			ctx.lineTo(frame[5].x, frame[5].y); // right knee
			ctx.lineTo(frame[6].x, frame[6].y); // right foot
			ctx.stroke();

			// Draw left arm
			ctx.beginPath();
			ctx.moveTo(frame[1].x, frame[1].y); // body
			ctx.lineTo(frame[7].x, frame[7].y); // left elbow
			ctx.lineTo(frame[8].x, frame[8].y); // left hand
			ctx.stroke();

			// Draw right arm
			ctx.beginPath();
			ctx.moveTo(frame[1].x, frame[1].y); // body
			ctx.lineTo(frame[9].x, frame[9].y); // right elbow
			ctx.lineTo(frame[10].x, frame[10].y); // right hand
			ctx.stroke();

			// Draw head circle (filled)
			ctx.beginPath();
			ctx.arc(frame[0].x, frame[0].y, 12, 0, Math.PI * 2);
			ctx.fillStyle = '#ffffff';  // White fill
			ctx.fill();
			ctx.stroke();
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
			} else if (isDragging && selectedJoint && selectedJoint !== joints[11]) {
				// Normal joint dragging - move only the selected joint
				selectedJoint.x = mouseX;
				selectedJoint.y = mouseY;
				saveCurrentFrame();
			}
		}

		function handleMouseUp() {
			isDragging = false;
			isDraggingWhole = false;
			selectedJoint = null;
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
			// Check middle joint first (larger hit area)
			const middleJoint = joints[11];
			if (middleJoint) {
				const dx = middleJoint.x - x;
				const dy = middleJoint.y - y;
				const distance = Math.sqrt(dx * dx + dy * dy);
				if (distance < 12) {
					return middleJoint;
				}
			}

			// Check other joints in reverse order so head (larger) gets priority
			for (let i = joints.length - 2; i >= 0; i--) {
				const joint = joints[i];
				const dx = joint.x - x;
				const dy = joint.y - y;
				const distance = Math.sqrt(dx * dx + dy * dy);

				// Different hit areas for different joints
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

			// Draw onion skin of previous frame (more transparent, Pivot style)
			if (frames.length > 1 && !isPlaying) {
				const prevFrameIndex = currentFrame === 0 ? frames.length - 1 : currentFrame - 1;
				ctx.save();
				ctx.globalAlpha = 0.3;
				ctx.strokeStyle = '#0066cc';
				ctx.lineWidth = 2;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';

				drawStickmanSkeleton(ctx, frames[prevFrameIndex]);

				// Draw previous frame joints (excluding middle)
				ctx.fillStyle = '#0066cc';
				frames[prevFrameIndex].forEach((joint, index) => {
					if (index === 11) return; // Skip middle joint
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