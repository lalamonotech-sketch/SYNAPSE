// Boot Initialization File
function initializeBoot() {
    // Ensure the title screen is properly configured at startup
    const titleScreen = document.querySelector('#title-screen');
    if(titleScreen) {
        titleScreen.style.opacity = 1;
        titleScreen.style.visibility = 'visible';
    }

    // Additional initialization logic can be added here
}

// Run the boot initialization function on startup
window.onload = initializeBoot;