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
		let templates = {};
		let currentSpeed = 1;

		// Joint constraints for maintaining body proportions
		const constraints = [
			{ joint1: 0, joint2: 1, distance: 40 },    // head to body
			{ joint1: 1, joint2: 2, distance: 25 },    // body to hips
			{ joint1: 2, joint2: 3, distance: 30 },    // hips to left knee
			{ joint1: 3, joint2: 4, distance: 25 },    // left knee to foot
			{ joint1: 2, joint2: 5, distance: 30 },    // hips to right knee
			{ joint1: 5, joint2: 6, distance: 25 },    // right knee to foot
			{ joint1: 1, joint2: 7, distance: 30 },    // body to left elbow
			{ joint1: 7, joint2: 8, distance: 20 },    // left elbow to hand
			{ joint1: 1, joint2: 9, distance: 30 },    // body to right elbow
			{ joint1: 9, joint2: 10, distance: 20 }    // right elbow to hand
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
				{ x: 200, y: 160, name: 'head' },
				{ x: 200, y: 200, name: 'body' },
				{ x: 200, y: 225, name: 'hips' },
				{ x: 170, y: 250, name: 'leftKnee' },
				{ x: 170, y: 275, name: 'leftFoot' },
				{ x: 230, y: 250, name: 'rightKnee' },
				{ x: 230, y: 275, name: 'rightFoot' },
				{ x: 170, y: 200, name: 'leftElbow' },
				{ x: 170, y: 220, name: 'leftHand' },
				{ x: 230, y: 200, name: 'rightElbow' },
				{ x: 230, y: 220, name: 'rightHand' }
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
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2;
			drawStickmanSkeleton(ctx, frame);

			// Draw head
			ctx.beginPath();
			ctx.arc(frame[0].x, frame[0].y, 8, 0, Math.PI * 2);
			ctx.stroke();
		}

		function drawStickman() {
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 4;
			drawStickmanSkeleton(ctx, joints);

			// Draw joints
			ctx.fillStyle = '#edf3c4';
			joints.forEach(joint => {
				ctx.beginPath();
				ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
				ctx.fill();
			});
		}

		function drawStickmanSkeleton(ctx, frame) {
			// Draw body line
			ctx.beginPath();
			ctx.moveTo(frame[0].x, frame[0].y);
			ctx.lineTo(frame[1].x, frame[1].y);
			ctx.lineTo(frame[2].x, frame[2].y);
			ctx.stroke();

			// Draw legs
			ctx.beginPath();
			ctx.moveTo(frame[2].x, frame[2].y);
			ctx.lineTo(frame[3].x, frame[3].y);
			ctx.lineTo(frame[4].x, frame[4].y);
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(frame[2].x, frame[2].y);
			ctx.lineTo(frame[5].x, frame[5].y);
			ctx.lineTo(frame[6].x, frame[6].y);
			ctx.stroke();

			// Draw arms
			ctx.beginPath();
			ctx.moveTo(frame[1].x, frame[1].y);
			ctx.lineTo(frame[7].x, frame[7].y);
			ctx.lineTo(frame[8].x, frame[8].y);
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(frame[1].x, frame[1].y);
			ctx.lineTo(frame[9].x, frame[9].y);
			ctx.lineTo(frame[10].x, frame[10].y);
			ctx.stroke();

			// Draw head
			ctx.beginPath();
			ctx.arc(frame[0].x, frame[0].y, 15, 0, Math.PI * 2);
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
			isDragging = !!selectedJoint;
		}

		function handleMouseMove(e) {
			if (isDragging && selectedJoint) {
				const { mouseX, mouseY } = getCanvasCoordinates(e);
				selectedJoint.x = mouseX;
				selectedJoint.y = mouseY;
				constrainJoints();
				saveCurrentFrame();
			}
		}

		function handleMouseUp() {
			isDragging = false;
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
			return joints.find(joint => {
				const dx = joint.x - x;
				const dy = joint.y - y;
				return Math.sqrt(dx * dx + dy * dy) < 10;
			});
		}

		function constrainJoints() {
			const iterations = 5;
			for (let i = 0; i < iterations; i++) {
				constraints.forEach(constraint => {
					const joint1 = joints[constraint.joint1];
					const joint2 = joints[constraint.joint2];

					const dx = joint2.x - joint1.x;
					const dy = joint2.y - joint1.y;
					const currentDistance = Math.sqrt(dx * dx + dy * dy);

					if (currentDistance === constraint.distance) return;

					const difference = (constraint.distance - currentDistance) / currentDistance;
					const offsetX = dx * 0.5 * difference;
					const offsetY = dy * 0.5 * difference;

					joint1.x -= offsetX;
					joint1.y -= offsetY;
					joint2.x += offsetX;
					joint2.y += offsetY;
				});
			}
		}
		
		// RENDERING LOOP
		
		function render() {
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Draw onion skin of previous frame
			if (frames.length > 1) {
				const prevFrameIndex = currentFrame === 0 ? frames.length - 1 : currentFrame - 1;
				ctx.save();
				ctx.strokeStyle = 'rgba(150, 150, 255, 0.4)';
				ctx.fillStyle = 'rgba(150, 150, 255, 0.2)';
				ctx.lineWidth = 3;
				drawStickmanSkeleton(ctx, frames[prevFrameIndex]);
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