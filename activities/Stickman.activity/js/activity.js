define([
	"sugar-web/activity/activity",
	"sugar-web/env",
	"sugar-web/graphics/presencepalette",
	"activity/palettes/speedpalette",
	"activity/palettes/templatepalette",
], function (
	activity,
	env,
	presencepalette,
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
		let stickmen = []; // Array of stickmen
		let selectedJoint = null;
		let selectedStickmanIndex = -1;
		let isDragging = false;
		let isDraggingWhole = false;
		let templates = {};
		let currentSpeed = 1;
		let dragStartPos = { x: 0, y: 0 };
		let originalJoints = [];
		let nextStickmanId = 0;
		let isRemovalMode = false;
		let currentenv;
		let isShared = false;
		let isRotating = false;
		let rotationPivot = null;
		let rotationStartAngle = 0;
		let neckManuallyMoved = false; // Track if neck has been manually positioned

		// Joint hierarchy - defines parent-child relationships for rotation
		const jointHierarchy = {
			2: [11], 		// hip -> middle
			11: [1], 		// middle -> body (neck rotates around middle)
			1: [0, 7, 9], 	// body -> head, left elbow, right elbow
			7: [8], 		// left elbow -> left hand
			9: [10], 		// right elbow -> right hand
			3: [4], 		// left knee -> left foot
			5: [6]			// right knee -> right foot
		};

		// Joint connections with proper distances
		const jointConnections = [
			{ from: 0, to: 1, length: 20 },    // head to body 
			{ from: 1, to: 11, length: 30 },   // body to middle
			{ from: 11, to: 2, length: 30 },   // middle to hips
			{ from: 2, to: 3, length: 40 },    // hips to left knee
			{ from: 3, to: 4, length: 40 },    // left knee to foot
			{ from: 2, to: 5, length: 40 },    // hips to right knee
			{ from: 5, to: 6, length: 40 },    // right knee to foot
			{ from: 1, to: 7, length: 40 },    // body to left elbow
			{ from: 7, to: 8, length: 30 },    // left elbow to hand
			{ from: 1, to: 9, length: 40 },    // body to right elbow
			{ from: 9, to: 10, length: 30 }    // right elbow to hand
		];

		// INITIALIZATION FUNCTIONS

		function initializeAnimator() {
			const canvasElement = document.getElementById('stickman-canvas');
			if (canvasElement) {
				initCanvas();
				initEvents();
				initControls();
				render();
			} else {
				console.warn('Canvas element not found, retrying...');
				setTimeout(initializeAnimator, 100);
			}
		}

		function setupDatastore() {
			activity.setup();

			env.getEnvironment(function (err, environment) {
				currentenv = environment;

				// Load from datastore
				if (!environment.objectId) {
					console.log("New instance");
					createInitialStickman();
					addFrame(); 
				} else {
					// load saved data
					activity.getDatastoreObject().loadAsText(function (error, metadata, data) {
						if (error == null && data != null) {
							const savedData = JSON.parse(data);

							// Restore saved state
							frames = savedData.frames || [];
							currentFrame = savedData.currentFrame || 0;
							speed = savedData.speed || 1;
							currentSpeed = savedData.currentSpeed || 1;
							nextStickmanId = savedData.nextStickmanId || 0;

							if (frames.length > 0) {
								stickmen = JSON.parse(JSON.stringify(frames[currentFrame]));
								stickmen.forEach((_, index) => updateMiddleJoint(index));
							} else {
								createInitialStickman();
								addFrame();
							}

							updateTimeline();
							updateRemoveButtonState(); // Update button state after loading
							render();
						} else {
							console.log("No instance found, creating new instance");
							createInitialStickman();
							addFrame();
						}
					});
				}

				if (environment.sharedId) {
					console.log("Shared instance");
					isShared = true;
					// shared activity logic goes here
				}
			});
		}

		document.getElementById('stop-button').addEventListener('click', function () {
			console.log("writing...");

			const saveData = {
				frames: frames,
				currentFrame: currentFrame,
				speed: speed,
				currentSpeed: currentSpeed,
				nextStickmanId: nextStickmanId
			};

			var jsonData = JSON.stringify(saveData);
			activity.getDatastoreObject().setDataAsText(jsonData);
			activity.getDatastoreObject().save(function (error) {
				if (error === null) {
					console.log("write done.");
				} else {
					console.log("write failed.");
				}
				activity.close();
			});
		});


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
			document.getElementById('addStickman-button').addEventListener('click', addNewStickman);
			document.getElementById('minus-button').addEventListener('click', removeSelectedStickman);

			// Initialize datastore
			setupDatastore();
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

		// STICKMAN CREATION & MANAGEMENT

		function createStickmanJoints(centerX, centerY, id) {
			return {
				id: id,
				joints: [
					{ x: centerX, y: centerY - 60, name: 'head' },            // 0 - head
					{ x: centerX, y: centerY - 40, name: 'body' },            // 1 - body
					{ x: centerX, y: centerY + 20, name: 'hips' },            // 2 - hips
					{ x: centerX - 20, y: centerY + 60, name: 'leftKnee' },   // 3 - left knee
					{ x: centerX - 25, y: centerY + 100, name: 'leftFoot' },  // 4 - left foot
					{ x: centerX + 20, y: centerY + 60, name: 'rightKnee' },  // 5 - right knee
					{ x: centerX + 25, y: centerY + 100, name: 'rightFoot' }, // 6 - right foot
					{ x: centerX - 30, y: centerY - 30, name: 'leftElbow' },  // 7 - left elbow
					{ x: centerX - 45, y: centerY, name: 'leftHand' },        // 8 - left hand
					{ x: centerX + 30, y: centerY - 30, name: 'rightElbow' }, // 9 - right elbow
					{ x: centerX + 45, y: centerY, name: 'rightHand' },       // 10 - right hand
					{ x: centerX, y: centerY - 10, name: 'middle' }           // 11 - middle (drag joint)
				]
			};
		}

		function createInitialStickman() {
			const centerX = canvas.width / 2;
			const centerY = canvas.height / 2;

			stickmen = [createStickmanJoints(centerX, centerY, nextStickmanId++)];
			neckManuallyMoved = false; // Reset flag for new stickman
			updateMiddleJoint(0);
			// by default first stickman is selected
			selectedStickmanIndex = 0;
			updateRemoveButtonState(); 
		}

		function addNewStickman() {
			// at a random position
			const centerX = Math.random() * (canvas.width - 200) + 100;
			const centerY = Math.random() * (canvas.height - 200) + 100;

			const newStickman = createStickmanJoints(centerX, centerY, nextStickmanId++);
			stickmen.push(newStickman);
			updateMiddleJoint(stickmen.length - 1);

			frames.forEach(frame => {
				frame.push(JSON.parse(JSON.stringify(newStickman)));
			});

			updateTimeline();
			updateRemoveButtonState(); 
			console.log(`Added new stickman. Total: ${stickmen.length}`);
		}

		function confirmationModal(stickmanId, stickmanToRemove) {
			// Create modal overlay
			const modalOverlay = document.createElement('div');
			modalOverlay.className = 'modal-overlay';

			// Create modal content
			const modal = document.createElement('div');
			modal.className = 'modal-content';

			// Create header
			const header = document.createElement('div');
			header.className = 'modal-header';

			// Create title
			const title = document.createElement('h3');
			title.textContent = 'Remove Stickman';
			title.className = 'modal-title';

			// Create body content
			const body = document.createElement('div');
			body.className = 'modal-body';

			// Create message
			const message = document.createElement('p');
			message.textContent = 'Are you sure you want to remove the Stickman ?';
			message.className = 'modal-message';

			// Create button container
			const buttonContainer = document.createElement('div');
			buttonContainer.className = 'modal-button-container';

			// Create cancel button
			const cancelButton = document.createElement('button');
			cancelButton.className = 'modal-button';
			cancelButton.innerHTML = `
				<span class="modal-button-icon modal-button-icon-cancel"></span>No
			`;

			// Create confirm button
			const confirmButton = document.createElement('button');
			confirmButton.className = 'modal-button modal-button-confirm';
			confirmButton.innerHTML = `
				<span class="modal-button-icon modal-button-icon-ok"></span>Yes
			`;

			// Add event listeners
			cancelButton.onclick = () => {
				document.body.removeChild(modalOverlay);
				exitRemovalMode();
			};

			confirmButton.onclick = () => {
				document.body.removeChild(modalOverlay);

				if (stickmen.length > 1) {
					// Remove from current stickmen array
					stickmen.splice(stickmanToRemove, 1);

					// Remove from all frames
					frames.forEach(frame => {
						frame.splice(stickmanToRemove, 1);
					});

					// Adjust selected stickman index if needed
					if (selectedStickmanIndex === stickmanToRemove) {
						selectedJoint = null;
						selectedStickmanIndex = stickmen.length > 0 ? 0 : -1;
					} else if (selectedStickmanIndex > stickmanToRemove) {
						selectedStickmanIndex--;
					}

					updateTimeline();
					updateRemoveButtonState();
				} else {
					console.error("Cannot remove the last stickman. At least one stickman must remain.");
				}

				exitRemovalMode();
			};

			// Close modal when clicking overlay
			modalOverlay.onclick = (e) => {
				if (e.target === modalOverlay) {
					document.body.removeChild(modalOverlay);
					exitRemovalMode();
				}
			};

			// Assemble modal
			header.appendChild(title);
			body.appendChild(message);
			buttonContainer.appendChild(cancelButton);
			buttonContainer.appendChild(confirmButton);
			body.appendChild(buttonContainer);
			modal.appendChild(header);
			modal.appendChild(body);
			modalOverlay.appendChild(modal);

			// Add to page
			document.body.appendChild(modalOverlay);
		}

		function removeSelectedStickman() {
			// Check if only one stickman remains
			if (stickmen.length <= 1) {
				console.log("Cannot remove the last stickman");
				return;
			}

			if (!isRemovalMode) {
				isRemovalMode = true;
				document.getElementById('minus-button').style.backgroundColor = '#ffcccc';
				document.getElementById('minus-button').style.border = '2px solid #ff0000';
				canvas.style.cursor = 'crosshair';
			} else {
				exitRemovalMode();
			}
		}

		function updateRemoveButtonState() {
			const minusButton = document.getElementById('minus-button');

			if (stickmen.length <= 1) {
				minusButton.disabled = true;
				minusButton.title = 'Cannot remove the last stickman';
			} else {
				minusButton.disabled = false;
				minusButton.title = 'Remove stickman';
			}
		}

		function exitRemovalMode() {
			isRemovalMode = false;
			document.getElementById('minus-button').style.backgroundColor = '';
			document.getElementById('minus-button').style.border = '';
			canvas.style.cursor = 'default';
		}

		function updateMiddleJoint(stickmanIndex) {
			if (stickmanIndex >= 0 && stickmanIndex < stickmen.length && !neckManuallyMoved) {
				const joints = stickmen[stickmanIndex].joints;
				joints[11].x = (joints[1].x + joints[2].x) / 2;
				joints[11].y = (joints[1].y + joints[2].y) / 2;
			}
		}

		function createNew() {
			frames = [];
			currentFrame = 0;
			stickmen = [];
			selectedJoint = null;
			selectedStickmanIndex = -1;
			createInitialStickman();
			addFrame();
			updateTimeline();
			pause();
		}

		async function loadTemplate(templateName) {
			try {
				const response = await fetch(`js/templates/${templateName}.json`);
				if (!response.ok) {
					throw new Error(`Failed to load template: ${templateName}`);
				}
				const templateData = await response.json();

				// For now, templates only work with single stickman
				// Reset to single stickman and load template
				stickmen = [createStickmanJoints(canvas.width / 2, canvas.height / 2, nextStickmanId++)];

				frames = JSON.parse(JSON.stringify(templateData.frames));
				frames.forEach(frame => {
					// Ensure frame is array of stickmen
					if (!Array.isArray(frame[0])) {
						if (frame.length === 11) {
							frame.push({
								x: (frame[1].x + frame[2].x) / 2,
								y: (frame[1].y + frame[2].y) / 2,
								name: 'middle'
							});
						}
						frame = [{ id: 0, joints: frame }];
					}
				});

				currentFrame = 0;
				if (frames.length > 0) {
					stickmen = JSON.parse(JSON.stringify(frames[currentFrame]));
				}
				updateMiddleJoint(0);
				updateTimeline();
			} catch (error) {
				console.error('Error loading template:', error);
				createInitialStickman();
				addFrame();
			}
		}

		// FRAME MANAGEMENT

		function addFrame() {
			// Update middle joints for all stickmen
			stickmen.forEach((_, index) => updateMiddleJoint(index));

			// Reset neck manually moved flag when adding a new frame
			neckManuallyMoved = false;

			// Deep copy all stickmen for this frame
			const frameData = JSON.parse(JSON.stringify(stickmen));
			frames.push(frameData);
			currentFrame = frames.length - 1;
			updateTimeline();
		}

		function saveCurrentFrame() {
			if (currentFrame >= 0) {
				// Don't update middle joints if we're currently rotating the neck
				// or if we're dragging the neck joint individually
				const isNeckOperation = (isRotating || isDragging) && selectedJoint && stickmen[selectedStickmanIndex] && 
					stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint) === 1;
				
				if (!isNeckOperation) {
					stickmen.forEach((_, index) => updateMiddleJoint(index));
				}
				frames[currentFrame] = JSON.parse(JSON.stringify(stickmen));
			}
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
					stickmen = JSON.parse(JSON.stringify(frame));
					neckManuallyMoved = false; // Reset flag when switching frames
					stickmen.forEach((_, stickmanIndex) => updateMiddleJoint(stickmanIndex));
					updateTimeline();
					render();
				});

				frameContainer.appendChild(previewCanvas);
				frameContainer.appendChild(deleteBtn);
				timeline.appendChild(frameContainer);
			});

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

			const isActive = index === currentFrame;
			previewCanvas.className = `frame ${isActive ? 'active' : ''}`;

			const previewCtx = previewCanvas.getContext('2d');
			previewCtx.fillStyle = isActive ? '#e6f3ff' : '#ffffff';
			previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

			// stickman to preview based on selection
			let stickmanToPreview = null;

			if (selectedStickmanIndex >= 0 && selectedStickmanIndex < frame.length) {
				// Show selected stickman
				stickmanToPreview = frame[selectedStickmanIndex];
			} else if (frame.length > 0) {
				// Show first stickman if no selection
				stickmanToPreview = frame[0];
			}

			if (stickmanToPreview && stickmanToPreview.joints) {
				const joints = stickmanToPreview.joints;

				// Calculate bounds for this single stickman
				const stickmanHeight = Math.max(...joints.map(p => p.y)) - Math.min(...joints.map(p => p.y));
				const stickmanWidth = Math.max(...joints.map(p => p.x)) - Math.min(...joints.map(p => p.x));
				const scale = Math.min(40 / stickmanHeight, 40 / stickmanWidth);

				const centerX = (Math.max(...joints.map(p => p.x)) + Math.min(...joints.map(p => p.x))) / 2;
				const centerY = (Math.max(...joints.map(p => p.y)) + Math.min(...joints.map(p => p.y))) / 2;

				previewCtx.save();
				previewCtx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
				previewCtx.scale(scale, scale);
				previewCtx.translate(-centerX, -centerY);

				// Draw only the selected stickman in preview
				drawStickmanPreview(previewCtx, joints);

				previewCtx.restore();
			}

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

		function drawStickmanPreview(ctx, joints) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			drawStickmanSkeleton(ctx, joints);

			ctx.fillStyle = '#ff0000';
			joints.forEach((joint, index) => {
				if (index === 11) 
					return; 
				ctx.beginPath();
				if (index === 0) {
					ctx.arc(joint.x, joint.y, 3, 0, Math.PI * 2);
				} else {
					ctx.arc(joint.x, joint.y, 2, 0, Math.PI * 2);
				}
				ctx.fill();
			});
		}

		function drawAllStickmen() {
			stickmen.forEach((stickman, stickmanIndex) => {
				drawStickman(stickman.joints, stickmanIndex);
			});
		}

		function drawStickman(joints, stickmanIndex) {
			// skeleton first
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			drawStickmanSkeleton(ctx, joints);

			// Show joints for selected stickman, or first stickman if none selected
			const shouldShowJoints = (selectedStickmanIndex >= 0)
				? stickmanIndex === selectedStickmanIndex
				: stickmanIndex === 0;

			// Only draw joints for the active stickman
			if (shouldShowJoints) {
				joints.forEach((joint, index) => {
					if (index === 11) 
						return; // Skip middle joint in regular drawing

					// Different colors for different joint types
					if (index === 2) { 
						// Hip joint - drag anchor
						ctx.fillStyle = '#00ff00';
						ctx.strokeStyle = '#00cc00';
					} else if (isRotationalJoint(index)) { 
						// Rotational joints
						ctx.fillStyle = '#ff8800';
						ctx.strokeStyle = '#cc6600';
					} else { 
						// Regular joints
						ctx.fillStyle = '#ff0000';
						ctx.strokeStyle = '#cc0000';
					}

					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				});
			}

			// Draw middle joint only for selected stickman 
			if (shouldShowJoints) {
				const middleJoint = joints[11];
				ctx.fillStyle = '#ff8800';
				ctx.strokeStyle = '#cc6600';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(middleJoint.x, middleJoint.y, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}

		function drawStickmanSkeleton(ctx, joints) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 12;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// body line
			ctx.beginPath();
			ctx.moveTo(joints[0].x, joints[0].y);
			ctx.lineTo(joints[1].x, joints[1].y);
			if (joints[11]) {
				ctx.lineTo(joints[11].x, joints[11].y);
			}
			ctx.lineTo(joints[2].x, joints[2].y);
			ctx.stroke();

			// left leg
			ctx.beginPath();
			ctx.moveTo(joints[2].x, joints[2].y); // hips
			ctx.lineTo(joints[3].x, joints[3].y); // left knee
			ctx.lineTo(joints[4].x, joints[4].y); // left foot
			ctx.stroke();

			// right leg
			ctx.beginPath();
			ctx.moveTo(joints[2].x, joints[2].y); // hips
			ctx.lineTo(joints[5].x, joints[5].y); // right knee
			ctx.lineTo(joints[6].x, joints[6].y); // right foot
			ctx.stroke();

			// left arm
			ctx.beginPath();
			ctx.moveTo(joints[1].x, joints[1].y); // body
			ctx.lineTo(joints[7].x, joints[7].y); // left elbow
			ctx.lineTo(joints[8].x, joints[8].y); // left hand
			ctx.stroke();

			// right arm
			ctx.beginPath();
			ctx.moveTo(joints[1].x, joints[1].y);    // body
			ctx.lineTo(joints[9].x, joints[9].y);    // right elbow
			ctx.lineTo(joints[10].x, joints[10].y);  // right hand
			ctx.stroke();

			// head circle (solid black)
			ctx.beginPath();
			ctx.arc(joints[0].x, joints[0].y, 17, 0, Math.PI * 2);
			ctx.fillStyle = '#000000';
			ctx.fill();
		}

		function maintainJointDistances(stickmanIndex, movedJointIndex) {
			// Skip distance maintenance for middle joint 
			if (movedJointIndex === 11) 
				return;

			const joints = stickmen[stickmanIndex].joints;

			// Get all connections for this joint
			const connections = jointConnections.filter(conn =>
				conn.from === movedJointIndex || conn.to === movedJointIndex
			);

			connections.forEach(conn => {
				const otherJointIndex = conn.from === movedJointIndex ? conn.to : conn.from;

				if (otherJointIndex === 11) 
					return;

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

		// HIERARCHICAL ROTATION SYSTEM

		function rotatePointAroundPivot(point, pivot, angle) {
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const dx = point.x - pivot.x;
			const dy = point.y - pivot.y;
			
			return {
				x: pivot.x + (dx * cos - dy * sin),
				y: pivot.y + (dx * sin + dy * cos)
			};
		}

		function rotateJointHierarchy(stickmanIndex, pivotJointIndex, angle) {
			const joints = stickmen[stickmanIndex].joints;
			let pivot;
			let pivotJointIndex_actual; // The joint that acts as the actual rotation pivot
			
			// Determine the actual pivot point for rotation
			if (pivotJointIndex === 11) { 
				// middle joint rotates around hip
				pivot = joints[2];
				pivotJointIndex_actual = 2;
			} else if (pivotJointIndex === 1) { 
				// body/neck rotates around middle joint
				pivot = joints[11];
				pivotJointIndex_actual = 11;
			} else if (pivotJointIndex === 7 || pivotJointIndex === 9) { 
				// elbows rotate around body
				pivot = joints[1];
				pivotJointIndex_actual = 1;
			} else if (pivotJointIndex === 3 || pivotJointIndex === 5) { 
				// knees rotate around hip
				pivot = joints[2];
				pivotJointIndex_actual = 2;
			} else {
				pivot = joints[pivotJointIndex];
				pivotJointIndex_actual = pivotJointIndex;
			}

			// Store pivot position to prevent it from changing during rotation
			const fixedPivot = { 
				x: pivot.x, 
				y: pivot.y 
			};

			// Rotate all child joints recursively
			function rotateChildren(parentIndex, rotationAngle) {
				const childIndices = jointHierarchy[parentIndex] || [];
				
				childIndices.forEach(childIndex => {
					// Never rotate the pivot joint itself
					if (childIndex === pivotJointIndex_actual) return;
					
					const oldPos = { 
						x: joints[childIndex].x, 
						y: joints[childIndex].y 
					};
					const newPos = rotatePointAroundPivot(oldPos, fixedPivot, rotationAngle);
					joints[childIndex].x = newPos.x;
					joints[childIndex].y = newPos.y;
					
					// Recursively rotate children of this joint
					rotateChildren(childIndex, rotationAngle);
				});
			}

			// First rotate the selected joint itself around its pivot (except pivot joints)
			if (pivotJointIndex !== pivotJointIndex_actual) {
				const oldPos = { 
					x: joints[pivotJointIndex].x, 
					y: joints[pivotJointIndex].y 
				};
				const newPos = rotatePointAroundPivot(oldPos, fixedPivot, angle);
				joints[pivotJointIndex].x = newPos.x;
				joints[pivotJointIndex].y = newPos.y;
			}

			// Then rotate all children
			rotateChildren(pivotJointIndex, angle);

			// Ensure pivot joint position is preserved (especially important for middle joint)
			if (pivotJointIndex_actual < joints.length) {
				joints[pivotJointIndex_actual].x = fixedPivot.x;
				joints[pivotJointIndex_actual].y = fixedPivot.y;
			}
		}

		function getAngle(point1, point2) {
			return Math.atan2(point2.y - point1.y, point2.x - point1.x);
		}

		function isRotationalJoint(jointIndex) {
			// These joints support rotation with hierarchical movement
			return [1, 2, 3, 5, 7, 9, 11].includes(jointIndex);
		}

		function getRotationPivot(stickmanIndex, jointIndex) {
			const joints = stickmen[stickmanIndex].joints;
			
			// Define pivot points for each rotational joint
			switch (jointIndex) {
				case 11: // middle joint rotates around hip
					return joints[2];
				case 1: // body/neck rotates around middle joint and return a copy of the middle joint position to prevent interference
					return { x: joints[11].x, y: joints[11].y };
				case 7: // left elbow rotates around body
					return joints[1];
				case 9: // right elbow rotates around body
					return joints[1];
				case 3: // left knee rotates around hip
					return joints[2];
				case 5: // right knee rotates around hip
					return joints[2];
				default:
					return joints[jointIndex]; // fallback
			}
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
			stickmen = JSON.parse(JSON.stringify(frames[currentFrame]));
			neckManuallyMoved = false; // Reset flag during animation
			stickmen.forEach((_, index) => updateMiddleJoint(index));
			updateTimeline();

			setTimeout(() => {
				requestAnimationFrame(animate);
			}, 1000 / (currentSpeed * 2));
		}

		// MOUSE INTERACTION

		function handleMouseDown(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);
			const result = findJointAtPosition(mouseX, mouseY);

			if (isRemovalMode && result) {
				// Remove the clicked stickman
				const stickmanToRemove = result.stickmanIndex;
				const stickmanId = stickmen[stickmanToRemove].id;

				confirmationModal(stickmanId, stickmanToRemove);
				return;
			}

			if (isRemovalMode) {
				exitRemovalMode();
				return;
			}

			// Normal selection 
			if (result) {
				const previousSelectedIndex = selectedStickmanIndex;
				selectedJoint = result.joint;
				selectedStickmanIndex = result.stickmanIndex;

				// Update timeline if selected stickman changed
				if (previousSelectedIndex !== selectedStickmanIndex) {
					updateTimeline();
				}

				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);

				if (selectedJointIndex === 2) { 

					// Hip joint - drag whole stickman
					isDraggingWhole = true;
					dragStartPos = { 
						x: mouseX, 
						y: mouseY 
					};
					originalJoints = JSON.parse(JSON.stringify(stickmen[selectedStickmanIndex].joints));

				} else if (isRotationalJoint(selectedJointIndex)) {
					// Start rotation for hierarchical joints
					isRotating = true;
					rotationPivot = getRotationPivot(selectedStickmanIndex, selectedJointIndex);
					rotationStartAngle = getAngle(
						rotationPivot, { 
							x: mouseX, 
							y: mouseY 
						}
					);
					originalJoints = JSON.parse(JSON.stringify(stickmen[selectedStickmanIndex].joints));
				} else {
					// Regular joint dragging for non-hierarchical joints (head, hands, feet)
					isDragging = true;
				}
			} else {
				const previousSelectedIndex = selectedStickmanIndex;
				selectedJoint = null;
				selectedStickmanIndex = -1;

				// Update timeline if selection was cleared
				if (previousSelectedIndex !== -1) {
					updateTimeline();
				}
			}
		}

		function handleMouseMove(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);

			if (isDraggingWhole && selectedStickmanIndex >= 0) {
				// Drag entire stickman using hip as anchor
				const deltaX = mouseX - dragStartPos.x;
				const deltaY = mouseY - dragStartPos.y;

				stickmen[selectedStickmanIndex].joints.forEach((joint, index) => {
					joint.x = originalJoints[index].x + deltaX;
					joint.y = originalJoints[index].y + deltaY;
				});

				saveCurrentFrame();
				updateTimeline();
			} else if (isRotating && selectedJoint && selectedStickmanIndex >= 0 && rotationPivot) {
				// Hierarchical rotation
				const currentAngle = getAngle(rotationPivot, { x: mouseX, y: mouseY });
				const angleDiff = currentAngle - rotationStartAngle;
				
				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);
				
				// Reset to original positions before applying rotation
				stickmen[selectedStickmanIndex].joints.forEach((joint, index) => {
					joint.x = originalJoints[index].x;
					joint.y = originalJoints[index].y;
				});
				
				// Apply rotation
				rotateJointHierarchy(selectedStickmanIndex, selectedJointIndex, angleDiff);
				
				// Mark neck as manually moved if we're rotating the neck joint
				if (selectedJointIndex === 1) {
					neckManuallyMoved = true;
				}
				
				// Only update middle joint position if we're not rotating the neck (body joint)
				// When rotating the neck around the middle joint, the middle joint should stay fixed
				if (selectedJointIndex !== 1) {
					updateMiddleJoint(selectedStickmanIndex);
				}

				saveCurrentFrame();
				updateTimeline();
			} else if (isDragging && selectedJoint && selectedStickmanIndex >= 0) {
				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);

				selectedJoint.x = mouseX;
				selectedJoint.y = mouseY;

				// Mark neck as manually moved if we're dragging the neck joint
				if (selectedJointIndex === 1) {
					neckManuallyMoved = true;
				}

				// Maintain distances only for the moved joint
				maintainJointDistances(selectedStickmanIndex, selectedJointIndex);

				// Update middle joint position only when hips moved (not when body/neck moved)
				if (selectedJointIndex === 2) {
					updateMiddleJoint(selectedStickmanIndex);
				}

				saveCurrentFrame();
				updateTimeline();
			}
		}

		function handleMouseUp() {
			const wasRotatingNeck = isRotating && selectedJoint && selectedStickmanIndex >= 0 && 
				stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint) === 1;
			
			const wasDraggingNeck = isDragging && selectedJoint && selectedStickmanIndex >= 0 && 
				stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint) === 1;

			isDragging = false;
			isDraggingWhole = false;
			isRotating = false;
			rotationPivot = null;
			originalJoints = [];

			if (currentFrame >= 0) {
				// Don't update middle joint if we just finished rotating or dragging the neck
				if (!wasRotatingNeck && !wasDraggingNeck) {
					saveCurrentFrame();
				} else {
					// Save without updating middle joints
					frames[currentFrame] = JSON.parse(JSON.stringify(stickmen));
				}
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
			// Check all stickmen, starting from the last one
			for (let stickmanIndex = stickmen.length - 1; stickmanIndex >= 0; stickmanIndex--) {
				const joints = stickmen[stickmanIndex].joints;

				// First check hip joint (index 2) - prioritize for whole stickman dragging
				const hipJoint = joints[2];
				if (hipJoint) {
					const dx = hipJoint.x - x;
					const dy = hipJoint.y - y;
					const distance = Math.sqrt(dx * dx + dy * dy);
					if (distance < 10) {
						return { 
							joint: hipJoint, 
							stickmanIndex: stickmanIndex 
						};
					}
				}

				// Check middle joint for rotation
				const middleJoint = joints[11];
				if (middleJoint) {
					const dx = middleJoint.x - x;
					const dy = middleJoint.y - y;
					const distance = Math.sqrt(dx * dx + dy * dy);
					if (distance < 8) {
						return { 
							joint: middleJoint, 
							stickmanIndex: stickmanIndex 
						};
					}
				}

				// Check other joints
				for (let i = joints.length - 2; i >= 0; i--) {
					if (i === 2) 
						continue; // Skip hip joint as it's already checked
					const joint = joints[i];
					const dx = joint.x - x;
					const dy = joint.y - y;
					const distance = Math.sqrt(dx * dx + dy * dy);

					const hitRadius = i === 0 ? 12 : 8;

					if (distance < hitRadius) {
						return { 
							joint: joint, 
							stickmanIndex: stickmanIndex 
						};
					}
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
				const prevFrame = frames[prevFrameIndex];

				ctx.save();
				ctx.globalAlpha = 0.3;
				ctx.strokeStyle = '#0066cc';
				ctx.lineWidth = 2;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';

				prevFrame.forEach(stickman => {
					drawStickmanSkeleton(ctx, stickman.joints);

					ctx.fillStyle = '#0066cc';
					stickman.joints.forEach((joint, index) => {
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
				});

				ctx.restore();
			}

			drawAllStickmen();
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

				const frameStickmen = frames[currentExportFrame];
				frameStickmen.forEach(stickman => {
					recordCtx.strokeStyle = '#000';
					recordCtx.lineWidth = 8;
					drawStickmanSkeleton(recordCtx, stickman.joints);
				});

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