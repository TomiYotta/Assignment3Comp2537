/**
 * Pokémon Memory Card Game
 * 
 * A jQuery-based memory matching game featuring Pokémon cards.
 * Players flip cards to find matching pairs within a time limit.
 * Includes difficulty levels, power-ups, and theme switching.
 */

$(document).ready(function () {
  // ======================
  // CONSTANTS & CONFIGURATION
  // ======================

  // API endpoint for Pokémon data
  const POKEMON_API_BASE_URL = "https://pokeapi.co/api/v2/pokemon/";
  
  // Template for Pokémon image URLs (official artwork)
  const POKEMON_IMAGE_PATH = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
  
  // Image for the back of cards (Pokéball)
  const CARD_BACK_IMAGE_URL = "back.webp";
  
  // Maximum Pokémon ID that has official artwork available
  const MAX_POKEMON_ID_FOR_ARTWORK = 1025;

  // Game difficulty settings (number of pairs and time limit)
  const gameSettings = {
    easy: { pairs: 3, time: 60 },    // 3 pairs, 60 seconds
    medium: { pairs: 6, time: 120 }, // 6 pairs, 2 minutes
    hard: { pairs: 10, time: 180 }   // 10 pairs, 3 minutes
  };

  // ======================
  // GAME STATE VARIABLES
  // ======================

  // Current game configuration
  let currentDifficulty, numPairs, totalTime;
  
  // Card tracking - stores the currently flipped cards
  let firstCard = null, secondCard = null;
  
  // Game status flags
  let lockBoard = false;    // Prevents interaction during card animations
  let gameActive = false;   // Whether a game is currently in progress
  
  // Game metrics
  let clicks = 0;          // Total clicks made
  let pairsMatched = 0;    // Number of matched pairs
  let timeLeft = 0;        // Remaining game time in seconds
  
  // Timer reference for cleanup
  let timerInterval;
  
  // Power-up tracking
  let powerUpUsedThisGame = false; // Whether power-up has been used
  
  // Cache of all Pokémon data to prevent repeated API calls
  let allPokemonList = [];

  // ======================
  // DOM ELEMENT REFERENCES
  // ======================

  // Game board and UI elements
  const $gameGrid = $("#game_grid");              // Container for cards
  const $timeLeftDisplay = $("#time-left");       // Timer display
  const $clicksDisplay = $("#clicks");            // Click counter
  const $pairsMatchedDisplay = $("#pairs-matched"); // Matched pairs
  const $pairsLeftDisplay = $("#pairs-left");     // Pairs remaining
  const $totalPairsDisplay = $("#total-pairs");   // Total pairs
  const $messageArea = $("#message-area");        // Status messages
  const $startButton = $("#start-button");        // Start game button
  const $resetButton = $("#reset-button");        // Reset game button
  const $difficultySelect = $("#difficulty");     // Difficulty selector
  const $themeToggleButton = $("#theme-toggle-button"); // Light/dark toggle
  const $powerUpButton = $("#power-up-button");   // Power-up button

  // ======================
  // GAME CONFIGURATION
  // ======================

  /**
   * Updates game settings based on selected difficulty
   */
  function updateGameConfig() {
    currentDifficulty = $difficultySelect.val();
    numPairs = gameSettings[currentDifficulty].pairs;
    totalTime = gameSettings[currentDifficulty].time;
  }

  // ======================
  // POKÉMON DATA HANDLING
  // ======================

  /**
   * Fetches and caches the complete Pokémon list from API
   * @returns {Array} List of Pokémon with id, name and imageUrl
   */
  async function fetchAllPokemonListOnce() {
    // Return cached data if available
    if (allPokemonList.length > 0) return allPokemonList;
    
    try {
        $messageArea.text("Fetching Data...").removeClass("text-pokedexButtonGreen text-red-500");
        
        // Fetch Pokémon list from API
        const response = await $.ajax({
            url: `${POKEMON_API_BASE_URL}?limit=1200`,
            method: 'GET'
        });
        
        if (!response || !response.results) throw new Error("Invalid API response.");
        
        // Process API response into usable Pokémon data
        allPokemonList = response.results
            .map(p => {
                if (!p || !p.url) return null;
                
                // Extract Pokémon ID from URL
                const urlParts = p.url.split('/');
                const idString = urlParts[urlParts.length - 2];
                const id = parseInt(idString);
                
                if (isNaN(id)) return null;
                
                // Create image URL and return formatted data
                const imageUrl = POKEMON_IMAGE_PATH(id);
                return { name: p.name, id: id, imageUrl: imageUrl };
            })
            // Filter out invalid entries and Pokémon without artwork
            .filter(p => p !== null && p.id > 0 && p.id <= MAX_POKEMON_ID_FOR_ARTWORK && p.imageUrl);
        
        if (allPokemonList.length === 0) {
             $messageArea.text("Load Failed!").addClass("text-red-500");
             throw new Error("No suitable Pokémon found.");
        }
        
        $messageArea.text("Data Loaded!");
        return allPokemonList;
    } catch (error) {
        console.error("Fetch/Process Pokémon list error:", error);
        $messageArea.text("API Error!").addClass("text-red-500");
        throw error;
    }
  }

  /**
   * Selects random Pokémon for the current game
   * @param {number} count - Number of Pokémon pairs needed
   * @returns {Array} Selected Pokémon data
   */
  async function selectRandomPokemonForGame(count) {
    try {
        const availablePokemon = await fetchAllPokemonListOnce();
        if (availablePokemon.length === 0) throw new Error("No Pokémon available.");
        
        // Adjust count if not enough Pokémon available
        if (availablePokemon.length < count) {
            console.warn(`Warning: Requested ${count} pairs, only ${availablePokemon.length} available. Adjusting.`);
            count = availablePokemon.length;
            numPairs = count;
        }
        
        // Shuffle and select random Pokémon
        const shuffled = [...availablePokemon].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    } catch (error) {
        console.error("Select Random Pokemon error:", error);
        return [];
    }
  }

  // ======================
  // GAME INITIALIZATION
  // ======================

  /**
   * Initializes a new game with selected difficulty
   */
  async function initializeGame() {
    // Set game state
    gameActive = true;
    lockBoard = false;
    powerUpUsedThisGame = false;
    $powerUpButton.prop('disabled', false);
    
    // Reset game metrics
    clicks = 0;
    pairsMatched = 0;
    firstCard = null;
    secondCard = null;
    
    // Clear any existing timer
    clearInterval(timerInterval);
    
    // Update configuration from UI
    updateGameConfig();
    $messageArea.text("Loading Cards...").removeClass("text-pokedexButtonGreen text-red-500");
    
    // Clear previous game
    $gameGrid.empty();

    // Determine grid layout based on difficulty
    let gridColsClass = 'grid-cols-3'; // Default for easy (3x2 grid)
    if (numPairs === 6) gridColsClass = 'grid-cols-4'; // Medium (4x3 grid)
    else if (numPairs >= 8 && numPairs <=10 ) gridColsClass = 'grid-cols-5'; // Hard (5x4 grid)
    
    // Apply grid layout
    $gameGrid.removeClass(function (index, className) {
        return (className.match(/(^|\s)grid-cols-\S+/g) || []).join(' ');
    }).addClass(gridColsClass);

    // Get Pokémon for this game
    const selectedPokemon = await selectRandomPokemonForGame(numPairs);

    // Handle case where no Pokémon could be loaded
    if (!selectedPokemon || selectedPokemon.length === 0) {
        if ($messageArea.text() === "Loading Cards...") {
             $messageArea.text("No Pokémon Data!").addClass("text-red-500");
        }
        gameActive = false;
        $powerUpButton.prop('disabled', true);
        return;
    }
    
    updateStatsDisplay();

    // Create card data (two cards per Pokémon)
    let cardsData = [];
    selectedPokemon.forEach(pokemon => {
      // Skip invalid Pokémon data
      if (!pokemon || typeof pokemon.id === 'undefined' || !pokemon.imageUrl || !pokemon.name) {
          console.warn("Skipping invalid pokemon data for cardsData:", pokemon);
          return;
      }
      
      // Create two cards for each Pokémon (a and b versions to prevent DOM conflicts)
      cardsData.push({ ...pokemon, cardId: `${pokemon.id}-a` });
      cardsData.push({ ...pokemon, cardId: `${pokemon.id}-b` });
    });

    // Error handling for card data
    if (cardsData.length === 0 && selectedPokemon.length > 0) {
        $messageArea.text("Card Data Error!").addClass("text-red-500");
        return;
    }
    
    // Shuffle cards
    cardsData.sort(() => 0.5 - Math.random());

    // Create and append card elements to DOM
    cardsData.forEach(data => {
      // Skip cards with missing data
      if (!data.imageUrl || !data.name) {
          console.error("CRITICAL: Missing data for card creation:", data);
          return;
      }
      
      // Card HTML template
      const cardElement = $(`
        <div class="card-container">
          <div class="card w-full h-16 sm:h-20 md:h-24 bg-transparent cursor-pointer" data-pokemon-id="${data.id}" data-card-id="${data.cardId}">
            <div class="card-inner">
              <!-- Card front (Pokéball) -->
              <div class="card-face card-front bg-pokedexButtonGray dark:bg-gray-600 p-1 flex justify-center items-center">
                <img src="${CARD_BACK_IMAGE_URL}" alt="Pokéball" class="max-w-[80%] max-h-[80%] object-contain">
              </div>
              <!-- Card back (Pokémon image) -->
              <div class="card-face card-back bg-white dark:bg-gray-200 p-1 flex justify-center items-center">
                <img data-src="${data.imageUrl}" alt="${data.name}" class="pokemon-image max-w-full max-h-full object-contain">
              </div>
            </div>
          </div>
        </div>
      `);
      
      $gameGrid.append(cardElement);
    });

    // Error handling for card display
    if ($gameGrid.children().length === 0 && cardsData.length > 0) {
        $messageArea.text("Card Display Error!").addClass("text-red-500");
        return;
    }

    // Add click handlers to cards
    $(".card").on("click", handleCardClick);
    
    // Initialize timer
    timeLeft = totalTime;
    startTimer();
    
    // Update UI
    updateStatsDisplay();
    $messageArea.text("Match 'em All!").removeClass("text-red-500");
  }

  // ======================
  // GAME LOGIC
  // ======================

  /**
   * Handles card click events
   */
  function handleCardClick() {
    const $thisCard = $(this);

    // Ignore clicks if:
    // - Game isn't active
    // - Board is locked (during animations)
    // - Card is already flipped or matched
    if (!gameActive || lockBoard || $thisCard.hasClass("flipped") || $thisCard.hasClass("matched")) {
      return;
    }

    // Lazy-load Pokémon image if not already loaded
    const $pokemonImage = $thisCard.find(".pokemon-image");
    const currentSrc = $pokemonImage.attr('src');
    const dataSrc = $pokemonImage.data('src');

    if (!currentSrc && dataSrc) {
        $pokemonImage.attr('src', dataSrc);
    }

    // Update click count and UI
    clicks++;
    updateStatsDisplay();
    
    // Flip card
    $thisCard.addClass("flipped");

    // First card of pair
    if (!firstCard) {
      firstCard = $thisCard;
    } 
    // Second card of pair
    else {
      // Prevent clicking the same card twice
      if ($thisCard.data("card-id") === firstCard.data("card-id")) {
          $thisCard.removeClass("flipped");
          clicks--; // Undo the click count
          updateStatsDisplay();
          return;
      }
      
      secondCard = $thisCard;
      lockBoard = true; // Lock board while checking match
      checkForMatch();
    }
  }

  /**
   * Checks if the two flipped cards match
   */
  function checkForMatch() {
    const isMatch = firstCard.data("pokemon-id") === secondCard.data("pokemon-id");
    
    // Handle match or mismatch
    isMatch ? processMatch() : processMismatch();
  }

  /**
   * Handles matching cards
   */
  function processMatch() {
    // Mark cards as matched
    firstCard.addClass("matched");
    secondCard.addClass("matched");
    
    // Update matched pairs count
    pairsMatched++;
    updateStatsDisplay();
    
    // Prepare for next turn
    resetTurnAfterDelay();
  }

  /**
   * Handles mismatched cards
   */
  function processMismatch() {
    // Flip cards back after delay
    setTimeout(() => {
      if (firstCard) firstCard.removeClass("flipped");
      if (secondCard) secondCard.removeClass("flipped");
      resetTurnAfterDelay();
    }, 1000);
  }
  
  /**
   * Resets turn state after delay
   */
  function resetTurnAfterDelay() {
    setTimeout(() => {
        // Clear current card references
        firstCard = null;
        secondCard = null;
        lockBoard = false;
        
        // Check for win condition
        if (gameActive && pairsMatched === numPairs) {
            endGame(true);
        }
    }, 200); 
  }

  // ======================
  // UI UPDATES
  // ======================

  /**
   * Updates all game stats displays
   */
  function updateStatsDisplay() {
    $clicksDisplay.text(clicks);
    $pairsMatchedDisplay.text(pairsMatched);
    $totalPairsDisplay.text(numPairs);
    $pairsLeftDisplay.text(numPairs - pairsMatched);
    $timeLeftDisplay.text(formatTime(timeLeft));
  }

  /**
   * Starts the game timer
   */
  function startTimer() {
    $timeLeftDisplay.text(formatTime(timeLeft));
    
    // Update timer every second
    timerInterval = setInterval(() => {
      timeLeft--;
      $timeLeftDisplay.text(formatTime(timeLeft));
      
      // Check for timeout
      if (timeLeft <= 0 && gameActive) {
        endGame(false);
      }
    }, 1000);
  }

  /**
   * Formats seconds into MM:SS display
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time string
   */
  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // ======================
  // GAME END
  // ======================

  /**
   * Handles game end (win or lose)
   * @param {boolean} isWin - Whether player won
   */
  function endGame(isWin) {
    // Prevent multiple endGame calls
    if (!gameActive && !isWin && timeLeft > 0) return;
    if (!gameActive && isWin) return;
    if (!gameActive && !isWin && timeLeft <= 0) return;

    // Set game as inactive
    gameActive = false;
    clearInterval(timerInterval);
    lockBoard = true;
    $powerUpButton.prop('disabled', true);
    
    // Ensure matched cards stay visible
    $('.card.matched').addClass('flipped'); 

    // Win condition
    if (isWin) {
      $messageArea.text("You Won!").addClass("text-pokedexButtonGreen").removeClass("text-red-500");
      
      // Show win alert after slight delay
      setTimeout(() => {
        alert("Congratulations! You matched all the Pokémon! You WIN!");
      }, 100); 
    } 
    // Lose condition (timeout)
    else {
      if (timeLeft <= 0) {
        $timeLeftDisplay.text("0:00");
        $messageArea.text("Game Over!").addClass("text-red-500").removeClass("text-pokedexButtonGreen");
        
        // Show lose alert after slight delay
        setTimeout(() => {
            alert("Time's up! You LOST! Better luck next time, trainer!");
        }, 100);
      }
    }
  }

  // ======================
  // EVENT HANDLERS
  // ======================

  // Start/Restart game buttons
  $startButton.on("click", initializeGame);
  $resetButton.on("click", initializeGame);

  // Difficulty selector change
  $difficultySelect.on("change", function() {
    updateGameConfig();
    
    // Only update display if no game is active
    if (!gameActive) {
        updateStatsDisplay();
        $timeLeftDisplay.text(formatTime(totalTime));
        $messageArea.text("Mode Set. Start!").removeClass("text-red-500 text-pokedexButtonGreen");
    }
  });

  // Theme toggle (light/dark mode)
  $themeToggleButton.on("click", function() {
    $("body").toggleClass("dark"); 
  });

  // Power-up button (reveal all cards temporarily)
  $powerUpButton.on("click", function() {
    // Ignore if game isn't active, board is locked, or power-up already used
    if (!gameActive || lockBoard || powerUpUsedThisGame) return;
    
    // Mark power-up as used
    powerUpUsedThisGame = true;
    $powerUpButton.prop('disabled', true);
    lockBoard = true;
    
    // Get all unmatched cards
    const $unmatchedCards = $(".card:not(.matched)");

    let imagesToLoad = 0;
    const cardsToVisuallyFlip = [];

    // Prepare cards for revealing
    $unmatchedCards.each(function() {
        const $card = $(this);
        cardsToVisuallyFlip.push($card);
        
        // Lazy-load images if needed
        const $pokemonImage = $card.find('.pokemon-image');
        if (!$pokemonImage.attr('src') && $pokemonImage.data('src')) {
            imagesToLoad++;
            $pokemonImage.attr('src', $pokemonImage.data('src')).one('load error', function() {
                imagesToLoad--;
                
                // When all images are loaded, execute reveal
                if (imagesToLoad === 0) {
                    executePowerUpReveal(cardsToVisuallyFlip);
                }
            });
        }
    });
    
    // If no images need loading, reveal immediately
    if (imagesToLoad === 0) {
        executePowerUpReveal(cardsToVisuallyFlip);
    }
  });

  /**
   * Executes the power-up reveal animation
   * @param {Array} cardsArray - Cards to reveal
   */
  function executePowerUpReveal(cardsArray) {
    // Flip all cards
    $(cardsArray).each(function() { $(this).addClass("flipped"); });

    let duration = 2000; // 2 second reveal
    
    // After duration, flip cards back (except matched and first selected card)
    setTimeout(() => {
      $(cardsArray).each(function() {
        const $card = $(this);
        
        // Keep first selected card flipped if it exists
        if (firstCard && $card.data('card-id') === firstCard.data('card-id')) {
            // Do nothing (keep flipped)
        } 
        // Flip back unmatched cards
        else if (!$card.hasClass('matched')) {
            $card.removeClass("flipped");
        }
      });
      
      // Unlock board (unless player has first card selected waiting for second)
      lockBoard = (firstCard && !secondCard); 
    }, duration);
  }

  // ======================
  // INITIAL SETUP
  // ======================

  // Initialize game configuration
  updateGameConfig();
  updateStatsDisplay();
  $timeLeftDisplay.text(formatTime(totalTime));
  
  // Pre-fetch Pokémon list for faster game starts
  fetchAllPokemonListOnce().catch(err => {
    console.warn("Initial Pokémon list pre-fetch failed. Will try again on game start. Error:", err);
  });
});