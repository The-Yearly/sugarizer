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
				]
			};
		}

		function createInitialStickman() {
			const centerX = canvas.width / 2;
			const centerY = canvas.height / 2;

			stickmen = [createStickmanJoints(centerX, centerY, nextStickmanId++)];
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
			message.textContent = `Are you sure you want to remove Stickman #${stickmanId}?`;
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
					console.log(`Removed Stickman #${stickmanId}. Remaining: ${stickmen.length}`);
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

			// Focus the cancel button by default
			cancelButton.focus();
		}

		function removeSelectedStickman() {
			// Check if only one stickman remains
			if (stickmen.length <= 1) {
				console.log("Cannot remove the last stickman. At least one stickman must remain.");
				return;
			}

			if (!isRemovalMode) {
				isRemovalMode = true;
				document.getElementById('minus-button').style.backgroundColor = '#ffcccc';
				document.getElementById('minus-button').style.border = '2px solid #ff0000';
				canvas.style.cursor = 'crosshair';
				console.log("Removal mode activated. Click on a stickman to remove it.");
			} else {
				exitRemovalMode();
			}
		}

		function updateRemoveButtonState() {
			const minusButton = document.getElementById('minus-button');

			if (stickmen.length <= 1) {
				minusButton.disabled = true;
				minusButton.style.opacity = '0.5';
				minusButton.style.cursor = 'not-allowed';
				minusButton.title = 'Cannot remove the last stickman';
			} else {
				minusButton.disabled = false;
				minusButton.style.opacity = '1';
				minusButton.style.cursor = 'pointer';
				minusButton.title = 'Remove stickman';
			}
		}

		function exitRemovalMode() {
			isRemovalMode = false;
			document.getElementById('minus-button').style.backgroundColor = '';
			document.getElementById('minus-button').style.border = '';
			canvas.style.cursor = 'default';
			console.log("Removal mode deactivated.");
		}

		function updateMiddleJoint(stickmanIndex) {
			if (stickmanIndex >= 0 && stickmanIndex < stickmen.length) {
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

			// Deep copy all stickmen for this frame
			const frameData = JSON.parse(JSON.stringify(stickmen));
			frames.push(frameData);
			currentFrame = frames.length - 1;
			updateTimeline();
		}

		function saveCurrentFrame() {
			if (currentFrame >= 0) {
				stickmen.forEach((_, index) => updateMiddleJoint(index));
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

			// bounds for all stickmen in this frame
			let allPoints = [];
			frame.forEach(stickman => {
				allPoints = allPoints.concat(stickman.joints);
			});

			if (allPoints.length > 0) {
				const stickmanHeight = Math.max(...allPoints.map(p => p.y)) - Math.min(...allPoints.map(p => p.y));
				const stickmanWidth = Math.max(...allPoints.map(p => p.x)) - Math.min(...allPoints.map(p => p.x));
				const scale = Math.min(40 / stickmanHeight, 40 / stickmanWidth);

				const centerX = (Math.max(...allPoints.map(p => p.x)) + Math.min(...allPoints.map(p => p.x))) / 2;
				const centerY = (Math.max(...allPoints.map(p => p.y)) + Math.min(...allPoints.map(p => p.y))) / 2;

				previewCtx.save();
				previewCtx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
				previewCtx.scale(scale, scale);
				previewCtx.translate(-centerX, -centerY);

				// Draw all stickmen in preview
				frame.forEach(stickman => {
					drawStickmanPreview(previewCtx, stickman.joints);
				});

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
					if (index === 11) return;

					ctx.fillStyle = '#ff0000';
					ctx.strokeStyle = '#cc0000';
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				});

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

			// Draw middle joint
			const middleJoint = joints[11];
			ctx.fillStyle = '#ffff00';
			ctx.strokeStyle = '#cccc00';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(middleJoint.x, middleJoint.y, 5, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}

		function drawStickmanSkeleton(ctx, joints) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 10;
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
			ctx.arc(joints[0].x, joints[0].y, 15, 0, Math.PI * 2);
			ctx.fillStyle = '#000000';
			ctx.fill();
		}

		function maintainJointDistances(stickmanIndex, movedJointIndex) {
			// Skip distance maintenance for middle joint 
			if (movedJointIndex === 11) return;

			const joints = stickmen[stickmanIndex].joints;

			// Get all connections for this joint
			const connections = jointConnections.filter(conn =>
				conn.from === movedJointIndex || conn.to === movedJointIndex
			);

			connections.forEach(conn => {
				const otherJointIndex = conn.from === movedJointIndex ? conn.to : conn.from;

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
			stickmen = JSON.parse(JSON.stringify(frames[currentFrame]));
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
				selectedJoint = result.joint;
				selectedStickmanIndex = result.stickmanIndex;

				if (selectedJoint === stickmen[selectedStickmanIndex].joints[11]) {
					// Clicked on middle joint start whole stickman drag
					isDraggingWhole = true;
					dragStartPos = { x: mouseX, y: mouseY };
					originalJoints = JSON.parse(JSON.stringify(stickmen[selectedStickmanIndex].joints));
				} else {
					isDragging = true;
				}
			} else {
				selectedJoint = null;
				selectedStickmanIndex = -1;
			}
		}

		function handleMouseMove(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);

			if (isDraggingWhole && selectedStickmanIndex >= 0) {
				// Drag entire stickman
				const deltaX = mouseX - dragStartPos.x;
				const deltaY = mouseY - dragStartPos.y;

				stickmen[selectedStickmanIndex].joints.forEach((joint, index) => {
					joint.x = originalJoints[index].x + deltaX;
					joint.y = originalJoints[index].y + deltaY;
				});

				saveCurrentFrame();
				updateTimeline();
			} else if (isDragging && selectedJoint && selectedStickmanIndex >= 0) {
				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);

				selectedJoint.x = mouseX;
				selectedJoint.y = mouseY;

				// Maintain distances only for the moved joint
				maintainJointDistances(selectedStickmanIndex, selectedJointIndex);

				// Update middle joint position if body or hips moved
				if (selectedJointIndex === 1 || selectedJointIndex === 2) {
					updateMiddleJoint(selectedStickmanIndex);
				}

				saveCurrentFrame();
				updateTimeline();
			}
		}

		function handleMouseUp() {
			isDragging = false;
			isDraggingWhole = false;

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
			// Check all stickmen, starting from the last one
			for (let stickmanIndex = stickmen.length - 1; stickmanIndex >= 0; stickmanIndex--) {
				const joints = stickmen[stickmanIndex].joints;

				// Check drag joint - middle joint
				const middleJoint = joints[11];
				if (middleJoint) {
					const dx = middleJoint.x - x;
					const dy = middleJoint.y - y;
					const distance = Math.sqrt(dx * dx + dy * dy);
					if (distance < 8) {
						return { joint: middleJoint, stickmanIndex: stickmanIndex };
					}
				}

				// Check other joints
				for (let i = joints.length - 2; i >= 0; i--) {
					const joint = joints[i];
					const dx = joint.x - x;
					const dy = joint.y - y;
					const distance = Math.sqrt(dx * dx + dy * dy);

					const hitRadius = i === 0 ? 12 : 8;

					if (distance < hitRadius) {
						return { joint: joint, stickmanIndex: stickmanIndex };
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
					recordCtx.lineWidth = 4;
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