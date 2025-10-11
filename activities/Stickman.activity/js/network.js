Stickman = Stickman || {};

Stickman.NetworkCheck = {
	connected: false,
	remoteBaseUrl: "",

	// Check if local AI models are available by trying to load a ping file
	check: function (callback) {
		const pingImage = new Image();
		const timestamp = new Date().getTime();

		pingImage.onload = () => {
			this.connected = true;
			if (callback)
				callback(this.connected);
		};

		pingImage.onerror = () => {
			this.connected = false;
			if (callback)
				callback(this.connected);
		};

		// Try to load a small test file from models directory
		pingImage.src = `models/_ping.png?${timestamp}`;
	},

	// Get the base URL for models (empty if local, remote URL if not local)
	getModelsBaseUrl: function () {
		if (this.connected) {
			return ""; // Local files available
		} else {
			// Remote URL - this should be configured to point to Sugarizer server
			return this.remoteBaseUrl + "activities/Stickman.activity/";
		}
	},

	// Set remote base URL (typically the Sugarizer server URL)
	setRemoteBaseUrl: function (url) {
		this.remoteBaseUrl = url.endsWith('/') ? url : url + '/';
	},

	// Get connection status
	isConnected: function () {
		return this.connected;
	}
};