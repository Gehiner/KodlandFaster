// Module to fetch and display student information on group pages
// Activates on: https://bo.kodland.org/groups/{id}

// Store authentication token. `var` on purpose - shared with
// early-auth-capture.js (document_start), which usually captures this
// before this file even runs. Guard against overwriting a value that
// script already found.
var authToken = (typeof authToken !== 'undefined' && authToken) ? authToken : null;

// Track processed students to avoid duplicate fetches
const processedStudents = new Set();

// Track if processing is in progress
let isProcessingStudents = false;

// Fallback interceptor installer, only used if early-auth-capture.js
// somehow didn't run (should be rare - it's a separate document_start
// content script matching the same pages).
function installAuthTokenInterceptorsFallback() {
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [url, options = {}] = args;
    
    // Check if Authorization header exists
    if (options.headers) {
      let authHeader = null;
      
      // Handle Headers object
      if (options.headers instanceof Headers) {
        authHeader = options.headers.get('Authorization');
      } 
      // Handle plain object
      else if (typeof options.headers === 'object') {
        authHeader = options.headers['Authorization'] || options.headers.Authorization;
      }
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const newToken = authHeader.replace('Bearer ', '').trim();
        if (newToken && newToken !== authToken) {
          authToken = newToken;
        }
      }
    }
    
    // Also check response headers for token hints (some APIs return tokens)
    const fetchPromise = originalFetch.apply(this, args);
    fetchPromise.then(response => {
      // Check if response contains auth info
      const authHeader = response.headers.get('Authorization') || response.headers.get('X-Auth-Token');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const newToken = authHeader.replace('Bearer ', '').trim();
        if (newToken && newToken !== authToken) {
          authToken = newToken;
        }
      }
    }).catch(() => {});
    
    return fetchPromise;
  };
  
  // Intercept XMLHttpRequest
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (header.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
      authToken = value.replace('Bearer ', '').trim();
    }
    return originalSetRequestHeader.apply(this, arguments);
  };
}

function captureAuthToken() {
  // The fetch/XHR interceptors are normally already installed by
  // early-auth-capture.js at document_start (before this script even runs).
  // Only install them here as a fallback, in case that file somehow didn't run.
  if (!window.__kodlandAuthInterceptorsInstalled) {
    window.__kodlandAuthInterceptorsInstalled = true;
    installAuthTokenInterceptorsFallback();
  }
  
  // Try to get token from localStorage/sessionStorage
  try {
    const keys = ['auth_token', 'token', 'access_token', 'bearer_token', 'jwt_token', 'api_token', 'accessToken', 'authToken'];
    for (const key of keys) {
      const storedToken = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (storedToken) {
        authToken = storedToken;
        break;
      }
    }
    
    // Also try to get all localStorage/sessionStorage keys and search for token-like values
    if (!authToken) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key);
          if (value && value.length > 50 && /^[A-Za-z0-9\-._~+/]+=*$/.test(value)) {
            // Looks like a JWT or token
            authToken = value;
            break;
          }
        }
      } catch (e) {
        // Ignore
      }
    }
  } catch (e) {
    console.warn('[Group Students Info] Could not access storage:', e);
  }
  
  // Try to get token from cookies
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      const cookieName = name.toLowerCase();
      if ((cookieName.includes('token') || cookieName.includes('auth') || cookieName.includes('access')) && value && value.length > 20) {
        authToken = decodeURIComponent(value);
        break;
      }
    }
  } catch (e) {
    console.warn('[Group Students Info] Could not access cookies:', e);
  }
  
  // Try to extract token from page scripts (some apps embed tokens)
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || script.innerHTML;
      // Look for common token patterns
      const tokenMatch = content.match(/(?:bearer|token|auth)[\s:=]+['"]([A-Za-z0-9\-._~+/]+=*)['"]/i);
      if (tokenMatch && tokenMatch[1]) {
        authToken = tokenMatch[1];
        break;
      }
    }
  } catch (e) {
    console.warn('[Group Students Info] Could not search scripts:', e);
  }
  
  // Monitor network requests for a short time to capture token
  setTimeout(() => {
    if (!authToken) {
      console.warn('[Group Students Info] ⚠️ No token captured yet. Waiting for network requests...');
      // Try one more time after a delay
      setTimeout(() => {
        if (!authToken) {
          console.error('[Group Students Info] ❌ No Bearer token found. API requests may fail with 401.');
          console.log('[Group Students Info] 💡 Tip: Try refreshing the page or making an action that triggers an API call.');
        }
      }, 5000);
    }
  }, 1000);
}

// ---------------------------------------------------------------------
// Group general info (backoffice API)
// ---------------------------------------------------------------------
// GET /api/v2/student_groups/{id}/get_general_info_for_group_backoffice_page
// One call gives us, among other things: chat_link (the WhatsApp group
// invite link), group_miro_board_url, group_teacher.full_name,
// predicted_end_date and course.title. We use it mainly to auto-detect the
// WhatsApp link (so the tutor doesn't have to paste it manually), with an
// in-memory cache so we don't hit the API more than needed per group.

const GROUP_INFO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const groupInfoCache = new Map(); // groupId -> { data, fetchedAt }
const groupInfoInFlight = new Map(); // groupId -> Promise (dedupes concurrent calls)

// Fetch (and cache) the general info blob for a group. Auto-saves chat_link
// into the same localStorage key the manual "paste link" flow reads from,
// so that flow becomes a fallback/correction tool instead of a requirement.
async function fetchGroupGeneralInfo(groupId, { force = false, _retry = false } = {}) {
  if (!groupId) return null;

  if (!force) {
    const cached = groupInfoCache.get(groupId);
    if (cached && (Date.now() - cached.fetchedAt) < GROUP_INFO_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  if (groupInfoInFlight.has(groupId)) {
    return groupInfoInFlight.get(groupId);
  }

  const requestPromise = (async () => {
    try {
      const apiUrl = `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/get_general_info_for_group_backoffice_page`;

      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const response = await fetch(apiUrl, { method: 'GET', credentials: 'include', headers });

      if (!response.ok) {
        console.warn(`[Group Info] HTTP ${response.status} fetching general info for group ${groupId}`);
        // The very first call on page load can race the auth token capture
        // (it only fills in once some other authenticated request fires).
        // Give it one retry a few seconds later before giving up.
        if (!_retry) {
          groupInfoInFlight.delete(groupId);
          await new Promise(resolve => setTimeout(resolve, 3000));
          return fetchGroupGeneralInfo(groupId, { force: true, _retry: true });
        }
        return null;
      }

      const data = await response.json();
      groupInfoCache.set(groupId, { data, fetchedAt: Date.now() });

      if (data && data.chat_link) {
        try {
          localStorage.setItem(`kodland_wa_group_link_${groupId}`, data.chat_link);
        } catch (e) {
          // Ignore storage errors (e.g. private mode)
        }
      }

      return data;
    } catch (error) {
      console.error(`[Group Info] Error fetching general info for group ${groupId}:`, error);
      return null;
    } finally {
      groupInfoInFlight.delete(groupId);
    }
  })();

  groupInfoInFlight.set(groupId, requestPromise);
  return requestPromise;
}

// Synchronous read of whatever's cached right now, without triggering a
// fetch. Use fetchGroupGeneralInfo() first (it's cheap once cached).
function getCachedGroupGeneralInfo(groupId) {
  const cached = groupInfoCache.get(groupId);
  return cached ? cached.data : null;
}

// Small convenience getters for other data the endpoint brings along for
// free - ready to wire into templates/UI as needed.
function getGroupMiroBoardUrl(groupId) {
  return getCachedGroupGeneralInfo(groupId)?.group_miro_board_url || null;
}

function getGroupTeacherName(groupId) {
  return getCachedGroupGeneralInfo(groupId)?.group_teacher?.full_name || null;
}

function getGroupPredictedEndDate(groupId) {
  return getCachedGroupGeneralInfo(groupId)?.predicted_end_date || null;
}

// ---------------------------------------------------------------------
// WhatsApp group link
// ---------------------------------------------------------------------
// Auto-detected via fetchGroupGeneralInfo() above (chat_link), which saves
// it into the same localStorage key this reads from. The tutor can still
// paste/correct it manually as a fallback if auto-detection ever fails.

// Get the cached WhatsApp group link for the current group, if any
function getGroupWhatsAppLink(groupIdOverride = null) {
  const groupId = groupIdOverride || extractGroupId();
  if (!groupId) return null;
  return localStorage.getItem(`kodland_wa_group_link_${groupId}`) || null;
}

// Function to check if we're on a group page
function isGroupPage() {
  const url = window.location.href;
  return /https?:\/\/bo\.kodland\.org\/groups\/\d+/.test(url);
}

// Function to extract group ID from URL
function extractGroupId() {
  const url = window.location.href;
  const match = url.match(/\/groups\/(\d+)/);
  return match ? match[1] : null;
}

// Function to extract student ID from a link element
function extractStudentId(linkElement) {
  if (!linkElement) return null;
  
  const href = linkElement.getAttribute('href');
  if (!href) return null;
  
  // Extract ID from /students/{id}
  const match = href.match(/\/students\/(\d+)/);
  return match ? match[1] : null;
}

// Function to find all student elements in the column
function findStudentElements() {
  // Look for elements with the structure: <a href="/students/{id}">
  // These are inside <div class="d-flex flex-column actions">
  const studentLinks = [];
  
  // Strategy 1: Find all links that match the pattern
  const allLinks = document.querySelectorAll('a[href^="/students/"]');
  
  for (const link of allLinks) {
    const studentId = extractStudentId(link);
    if (studentId) {
      // Find the parent container with class "actions"
      const container = link.closest('.d-flex.flex-column.actions') || 
                       link.closest('[class*="actions"]') ||
                       link.parentElement;
      
      if (container) {
        studentLinks.push({
          id: studentId,
          link: link,
          container: container,
          name: link.querySelector('h3')?.textContent?.trim() || 'Unknown',
          email: link.parentElement?.querySelector('.student-info__subtitle')?.textContent?.trim() || ''
        });
      }
    }
  }
  
  console.log(`[Group Students Info] Found ${studentLinks.length} students`);
  return studentLinks;
}

// Function to fetch student information from API
async function fetchStudentInfo(studentId) {
  const apiUrl = `https://backoffice.kodland.org/api/v2/students/${studentId}/get_general_info_for_student_backoffice_page/`;
  
  try {
    
    // Prepare headers
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    // Add Bearer token if available
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else {
      // Try to capture token one more time by waiting a bit
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        console.error(`[Group Students Info] ❌ No Bearer token available for student ${studentId}`);
        return null;
      }
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include', // Include cookies for authentication
      headers: headers
    });
    
    if (!response.ok) {
      console.error(`[Group Students Info] HTTP error! status: ${response.status} for student ${studentId}`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`[Group Students Info] Response is not JSON for student ${studentId}`);
      return null;
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    console.error(`[Group Students Info] Error fetching student ${studentId}:`, error);
    return null;
  }
}

// Function to fetch homework modules progress for a student
async function fetchHomeworkModulesProgress(studentId, groupId) {
  const apiUrl = `https://backoffice.kodland.org/api/v2/students/${studentId}/group/${groupId}/get_progress_for_homework_modules/`;
  
  try {
    
    // Prepare headers
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    // Add Bearer token if available
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        console.error(`[Group Students Info] ❌ No Bearer token available for progress`);
        return null;
      }
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers
    });
    
    if (!response.ok) {
      console.error(`[Group Students Info] HTTP error! status: ${response.status} for homework modules progress`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`[Group Students Info] Response is not JSON for homework modules progress`);
      return null;
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    console.error(`[Group Students Info] Error fetching homework modules progress:`, error);
    return null;
  }
}

// Function to get completed lessons count from the page
function getCompletedLessonsCount() {
  const xpath = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div[1]/div[1]/div[2]/div[2]/div[2]/div/div/div[6]/div/div/span/span';
  
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    const element = result.singleNodeValue;
    if (element) {
      const text = element.textContent?.trim() || element.innerText?.trim() || '';
      console.log(`[getCompletedLessonsCount] ✅ Found element with text: "${text}"`);
      
      // Extract format like "7/14" where 7 is completed and 14 is total
      const match = text.match(/(\d+)\/(\d+)/);
      if (match) {
        const completed = parseInt(match[1], 10);
        const total = parseInt(match[2], 10);
        console.log(`[getCompletedLessonsCount] ✅ Successfully extracted: ${completed} completed out of ${total} total`);
        return { completed, total };
      } else {
        console.warn(`[getCompletedLessonsCount] ⚠️ Text found but doesn't match format "X/Y": "${text}"`);
      }
    } else {
      console.warn(`[getCompletedLessonsCount] ⚠️ Element not found with XPath`);
    }
  } catch (error) {
    console.error('[getCompletedLessonsCount] ❌ Error finding element:', error);
  }
  
  // Fallback: return null if not found
  console.warn('[getCompletedLessonsCount] ❌ Could not find completed lessons count - returning null');
  return null;
}

// Function to extract lesson IDs from modules progress data
function extractLessonIds(modulesData, maxLessons = null) {
  // Preserve discovery order (as returned by the API) while deduping
  const lessonIds = [];
  const seen = new Set();
  
  if (!modulesData) {
    console.warn('[extractLessonIds] No modules data provided');
    return [];
  }
  
  // Try to find lesson IDs in different possible structures
  function addLessonId(id, path) {
    if (id === undefined || id === null) return;
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      lessonIds.push(id);
      console.log(`[extractLessonIds] Found lesson id: ${id} at path: ${path}`);
    }
  }
  
  function extractFromObject(obj, path = '') {
    if (!obj || typeof obj !== 'object') return;
    
    // Check if this object has a lesson_id or id field
    if (obj.hasOwnProperty('lesson_id')) addLessonId(obj.lesson_id, path);
    if (obj.hasOwnProperty('lessonId')) addLessonId(obj.lessonId, path);
    if (obj.hasOwnProperty('id') && path.includes('lesson')) addLessonId(obj.id, path);
    
    // Recursively search in nested objects and arrays
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          extractFromObject(item, `${newPath}[${index}]`);
        });
      } else if (value && typeof value === 'object') {
        extractFromObject(value, newPath);
      }
    }
  }
  
  extractFromObject(modulesData);
  
  let lessonIdsArray = lessonIds;
  console.log(`[extractLessonIds] Found ${lessonIdsArray.length} total lesson IDs before limiting (order preserved)`);
  
  // Limit to completed lessons if maxLessons is specified
  if (maxLessons !== null && maxLessons > 0) {
    if (lessonIdsArray.length > maxLessons) {
      const originalLength = lessonIdsArray.length;
      lessonIdsArray = lessonIdsArray.slice(0, maxLessons);
      console.log(`[extractLessonIds] ✅ Limited to ${maxLessons} completed lessons (out of ${originalLength} total found)`);
    } else {
      console.log(`[extractLessonIds] Found ${lessonIdsArray.length} lessons (less than or equal to ${maxLessons} completed)`);
    }
  } else {
    console.warn(`[extractLessonIds] ⚠️ No maxLessons limit specified, will process all ${lessonIdsArray.length} found lessons`);
  }
  
  console.log(`[extractLessonIds] Final extracted ${lessonIdsArray.length} lesson IDs:`, lessonIdsArray);
  return lessonIdsArray;
}

// Function to fetch class tasks progress for a lesson
async function fetchClassTasksProgress(studentId, lessonId) {
  const apiUrl = `https://backoffice.kodland.org/api/v2/students/${studentId}/lesson/${lessonId}/get_progress_for_class_tasks/`;
  
  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers
    });
    
    if (!response.ok) {
      console.error(`[Group Students Info] HTTP error! status: ${response.status} for class tasks (lesson ${lessonId})`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`[Group Students Info] Response is not JSON for class tasks (lesson ${lessonId})`);
      return null;
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    console.error(`[Group Students Info] Error fetching class tasks progress for lesson ${lessonId}:`, error);
    return null;
  }
}

// Function to fetch homework tasks progress for a lesson
async function fetchHomeworkTasksProgress(studentId, lessonId) {
  const apiUrl = `https://backoffice.kodland.org/api/v2/students/${studentId}/lesson/${lessonId}/get_progress_for_homework_tasks/`;
  
  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers
    });
    
    if (!response.ok) {
      console.error(`[Group Students Info] HTTP error! status: ${response.status} for homework tasks (lesson ${lessonId})`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`[Group Students Info] Response is not JSON for homework tasks (lesson ${lessonId})`);
      return null;
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    console.error(`[Group Students Info] Error fetching homework tasks progress for lesson ${lessonId}:`, error);
    return null;
  }
}

// Function to organize tasks data by modules and lessons
function organizeTasksByModules(modulesData, tasksData) {
  const organized = {};
  
  // First, try to organize by modules from modulesData
  if (Array.isArray(modulesData)) {
    modulesData.forEach((module, moduleIndex) => {
      const moduleName = module.name || module.title || module.module_name || `Module ${moduleIndex + 1}`;
      const moduleId = module.id || module.module_id || moduleIndex;
      
      if (!organized[moduleId]) {
        organized[moduleId] = {
          id: moduleId,
          name: moduleName,
          lessons: []
        };
      }
      
      // Extract lessons from module
      if (module.lessons && Array.isArray(module.lessons)) {
        module.lessons.forEach((lesson, lessonIndex) => {
          const lessonId = lesson.id || lesson.lesson_id || tasksData[lessonIndex]?.lessonId;
          if (lessonId) {
            const taskData = tasksData.find(t => t.lessonId == lessonId);
            organized[moduleId].lessons.push({
              id: lessonId,
              name: lesson.name || lesson.title || `Lesson ${lessonIndex + 1}`,
              classTasks: taskData?.classTasks || null,
              homeworkTasks: taskData?.homeworkTasks || null
            });
          }
        });
      }
    });
  } else if (typeof modulesData === 'object' && modulesData !== null) {
    // If modulesData is an object, try to extract modules
    const modulesArray = modulesData.modules || modulesData.data || [modulesData];
    modulesArray.forEach((module, moduleIndex) => {
      const moduleName = module.name || module.title || module.module_name || `Module ${moduleIndex + 1}`;
      const moduleId = module.id || module.module_id || moduleIndex;
      
      if (!organized[moduleId]) {
        organized[moduleId] = {
          id: moduleId,
          name: moduleName,
          lessons: []
        };
      }
    });
  }
  
  // If no modules found, organize by lessons directly
  if (Object.keys(organized).length === 0) {
    organized['default'] = {
      id: 'default',
      name: 'All Lessons',
      lessons: tasksData.map((taskData, index) => ({
        id: taskData.lessonId,
        name: `Lesson ${index + 1}`,
        classTasks: taskData.classTasks,
        homeworkTasks: taskData.homeworkTasks
      }))
    };
  } else {
    // Map tasks to lessons in modules
    tasksData.forEach(taskData => {
      // Try to find which module this lesson belongs to
      let found = false;
      for (const moduleId in organized) {
        const module = organized[moduleId];
        const existingLesson = module.lessons.find(l => l.id == taskData.lessonId);
        if (existingLesson) {
          existingLesson.classTasks = taskData.classTasks;
          existingLesson.homeworkTasks = taskData.homeworkTasks;
          found = true;
          break;
        }
      }
      
      // If not found in any module, add to first module or create default
      if (!found) {
        const firstModuleId = Object.keys(organized)[0];
        organized[firstModuleId].lessons.push({
          id: taskData.lessonId,
          name: `Lesson ${taskData.lessonId}`,
          classTasks: taskData.classTasks,
          homeworkTasks: taskData.homeworkTasks
        });
      }
    });
  }
  
  return organized;
}

// Function to calculate task percentages
function calculateTaskPercentages(organizedData) {
  let totalHomework = 0;
  let submittedHomework = 0;
  let totalClass = 0;
  let submittedClass = 0;
  
  Object.values(organizedData).forEach(module => {
    module.lessons.forEach(lesson => {
      // Count homework tasks
      if (lesson.homeworkTasks) {
        let homeworkTasks = [];
        if (Array.isArray(lesson.homeworkTasks)) {
          homeworkTasks = lesson.homeworkTasks;
        } else if (typeof lesson.homeworkTasks === 'object' && lesson.homeworkTasks !== null) {
          homeworkTasks = lesson.homeworkTasks.tasks || lesson.homeworkTasks.data || [lesson.homeworkTasks];
        }
        
        homeworkTasks.forEach(task => {
          const statusKey = task.task_status_key || task.status_key || '';
          totalHomework++;
          if (statusKey === 'TASK_SUBMITTED' || statusKey === 'TASK_CHECKED' || statusKey === 'TASK_SUBMITTED_LATE') {
            submittedHomework++;
          }
        });
      }
      
      // Count class tasks
      if (lesson.classTasks) {
        let classTasks = [];
        if (Array.isArray(lesson.classTasks)) {
          classTasks = lesson.classTasks;
        } else if (typeof lesson.classTasks === 'object' && lesson.classTasks !== null) {
          classTasks = lesson.classTasks.tasks || lesson.classTasks.data || [lesson.classTasks];
        }
        
        classTasks.forEach(task => {
          const statusKey = task.task_status_key || task.status_key || '';
          totalClass++;
          if (statusKey === 'TASK_SUBMITTED' || statusKey === 'TASK_CHECKED' || statusKey === 'TASK_SUBMITTED_LATE') {
            submittedClass++;
          }
        });
      }
    });
  });
  
  const homeworkPercentage = totalHomework > 0 ? Math.round((submittedHomework / totalHomework) * 100) : 100;
  const classPercentage = totalClass > 0 ? Math.round((submittedClass / totalClass) * 100) : 100;
  
  return {
    homeworkPercentage,
    classPercentage,
    totalHomework,
    submittedHomework,
    totalClass,
    submittedClass
  };
}

// Function to generate weekly summary message
function generateWeeklySummaryMessage(studentName, lessonsCompleted, percentages, language = 'es') {
  const { homeworkPercentage, classPercentage } = percentages;
  
  const messages = {
    es: {
      greeting: `Hola ${studentName},`,
      intro: `Aquí está tu resumen semanal, llevamos ya ${lessonsCompleted} lecciones realizadas y tienes ${homeworkPercentage}% de actividades en casa entregadas y ${classPercentage}% de actividades en clase entregadas.`,
      allCompleted: `¡Felicidades! Has completado todas tus actividades. Sigue así, estás haciendo un excelente trabajo.`,
      lowPercentage: `Veo que hay algunas actividades pendientes. No te preocupes, puedes contar con mi apoyo para completarlas. Si deseas mi ayuda para saber cuáles son las actividades y revisarlas, no dudes en contactarme.`,
      regularPercentage: `Estás haciendo un buen progreso. Si deseas mi ayuda para saber cuáles son las actividades y revisarlas, no dudes en contactarme.`
    },
    en: {
      greeting: `Hello ${studentName},`,
      intro: `Here is your weekly summary, we have completed ${lessonsCompleted} lessons and you have ${homeworkPercentage}% of homework activities submitted and ${classPercentage}% of class activities submitted.`,
      allCompleted: `Congratulations! You have completed all your activities. Keep it up, you're doing an excellent job.`,
      lowPercentage: `I see there are some pending activities. Don't worry, you can count on my support to complete them. If you need help knowing which activities they are and reviewing them, don't hesitate to contact me.`,
      regularPercentage: `You're making good progress. If you need help knowing which activities they are and reviewing them, don't hesitate to contact me.`
    },
    ru: {
      greeting: `Привет ${studentName},`,
      intro: `Вот твоя еженедельная сводка, мы уже выполнили ${lessonsCompleted} уроков, и у тебя ${homeworkPercentage}% домашних заданий сдано и ${classPercentage}% классных заданий сдано.`,
      allCompleted: `Поздравляю! Ты выполнил все свои задания. Продолжай в том же духе, ты отлично справляешься.`,
      lowPercentage: `Я вижу, что есть некоторые невыполненные задания. Не волнуйся, ты можешь рассчитывать на мою поддержку для их выполнения. Если тебе нужна помощь, чтобы узнать, какие это задания, и проверить их, не стесняйся связаться со мной.`,
      regularPercentage: `Ты делаешь хороший прогресс. Если тебе нужна помощь, чтобы узнать, какие это задания, и проверить их, не стесняйся связаться со мной.`
    },
    fr: {
      greeting: `Bonjour ${studentName},`,
      intro: `Voici ton résumé hebdomadaire, nous avons déjà complété ${lessonsCompleted} leçons et tu as ${homeworkPercentage}% d'activités à la maison soumises et ${classPercentage}% d'activités en classe soumises.`,
      allCompleted: `Félicitations ! Tu as complété toutes tes activités. Continue comme ça, tu fais un excellent travail.`,
      lowPercentage: `Je vois qu'il y a quelques activités en attente. Ne t'inquiète pas, tu peux compter sur mon soutien pour les compléter. Si tu souhaites mon aide pour savoir quelles sont les activités et les réviser, n'hésite pas à me contacter.`,
      regularPercentage: `Tu fais de bons progrès. Si tu souhaites mon aide pour savoir quelles sont les activités et les réviser, n'hésite pas à me contacter.`
    },
    tr: {
      greeting: `Merhaba ${studentName},`,
      intro: `İşte haftalık özetin, ${lessonsCompleted} ders tamamladık ve ev ödevlerinin %${homeworkPercentage}'i ve sınıf aktivitelerinin %${classPercentage}'i teslim edildi.`,
      allCompleted: `Tebrikler! Tüm aktivitelerini tamamladın. Böyle devam et, harika bir iş çıkarıyorsun.`,
      lowPercentage: `Bazı bekleyen aktiviteler olduğunu görüyorum. Endişelenme, bunları tamamlamak için desteğime güvenebilirsin. Hangi aktiviteler olduğunu öğrenmek ve bunları gözden geçirmek için yardımıma ihtiyacın olursa, benimle iletişime geçmekten çekinme.`,
      regularPercentage: `İyi bir ilerleme kaydediyorsun. Hangi aktiviteler olduğunu öğrenmek ve bunları gözden geçirmek için yardımıma ihtiyacın olursa, benimle iletişime geçmekten çekinme.`
    },
    id: {
      greeting: `Halo ${studentName},`,
      intro: `Berikut ringkasan mingguan Anda, kami telah menyelesaikan ${lessonsCompleted} pelajaran dan Anda memiliki ${homeworkPercentage}% aktivitas rumah yang dikirim dan ${classPercentage}% aktivitas kelas yang dikirim.`,
      allCompleted: `Selamat! Anda telah menyelesaikan semua aktivitas Anda. Teruskan, Anda melakukan pekerjaan yang sangat baik.`,
      lowPercentage: `Saya melihat ada beberapa aktivitas yang tertunda. Jangan khawatir, Anda dapat mengandalkan dukungan saya untuk menyelesaikannya. Jika Anda ingin bantuan saya untuk mengetahui aktivitas mana dan meninjau mereka, jangan ragu untuk menghubungi saya.`,
      regularPercentage: `Anda membuat kemajuan yang baik. Jika Anda ingin bantuan saya untuk mengetahui aktivitas mana dan meninjau mereka, jangan ragu untuk menghubungi saya.`
    },
    it: {
      greeting: `Ciao ${studentName},`,
      intro: `Ecco il tuo riepilogo settimanale, abbiamo già completato ${lessonsCompleted} lezioni e hai ${homeworkPercentage}% di attività a casa consegnate e ${classPercentage}% di attività in classe consegnate.`,
      allCompleted: `Congratulazioni! Hai completato tutte le tue attività. Continua così, stai facendo un ottimo lavoro.`,
      lowPercentage: `Vedo che ci sono alcune attività in sospeso. Non preoccuparti, puoi contare sul mio supporto per completarle. Se desideri il mio aiuto per sapere quali sono le attività e rivederle, non esitare a contattarmi.`,
      regularPercentage: `Stai facendo buoni progressi. Se desideri il mio aiuto per sapere quali sono le attività e rivederle, non esitare a contattarmi.`
    },
    pl: {
      greeting: `Cześć ${studentName},`,
      intro: `Oto twoje cotygodniowe podsumowanie, ukończyliśmy już ${lessonsCompleted} lekcji i masz ${homeworkPercentage}% zadań domowych przesłanych i ${classPercentage}% zadań klasowych przesłanych.`,
      allCompleted: `Gratulacje! Ukończyłeś wszystkie swoje zadania. Tak trzymaj, robisz świetną robotę.`,
      lowPercentage: `Widzę, że są jeszcze niektóre zadania do wykonania. Nie martw się, możesz liczyć na moje wsparcie w ich ukończeniu. Jeśli chcesz mojej pomocy, aby dowiedzieć się, jakie to zadania i je przejrzeć, nie wahaj się ze mną skontaktować.`,
      regularPercentage: `Robisz dobre postępy. Jeśli chcesz mojej pomocy, aby dowiedzieć się, jakie to zadania i je przejrzeć, nie wahaj się ze mną skontaktować.`
    },
    pt: {
      greeting: `Olá ${studentName},`,
      intro: `Aqui está o seu resumo semanal, já completamos ${lessonsCompleted} lições e você tem ${homeworkPercentage}% de atividades em casa entregues e ${classPercentage}% de atividades em classe entregues.`,
      allCompleted: `Parabéns! Você completou todas as suas atividades. Continue assim, está fazendo um excelente trabalho.`,
      lowPercentage: `Vejo que há algumas atividades pendentes. Não se preocupe, você pode contar com meu apoio para completá-las. Se desejar minha ajuda para saber quais são as atividades e revisá-las, não hesite em entrar em contato comigo.`,
      regularPercentage: `Você está fazendo um bom progresso. Se desejar minha ajuda para saber quais são as atividades e revisá-las, não hesite em entrar em contato comigo.`
    }
  };
  
  const msg = messages[language] || messages.es;
  
  let message = `${msg.greeting}\n\n${msg.intro}\n\n`;
  
  // Determine message based on percentages
  if (homeworkPercentage === 100 && classPercentage === 100) {
    message += msg.allCompleted;
  } else if (homeworkPercentage < 50 || classPercentage < 50) {
    message += msg.lowPercentage;
  } else {
    message += msg.regularPercentage;
  }
  
  return message;
}

// Function to create and show tasks modal
function showTasksModal(studentId, modulesData, tasksData, onRefresh = null) {
  // Remove existing modal if any
  const existingModal = document.getElementById('kodland-tasks-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Detect language and path for links
  const detectedLang = detectPageLanguage();
  const langUrlMap = {
    'es': 'es',
    'en': 'en',
    'ru': 'ru',
    'fr': 'fr',
    'tr': 'tr',
    'id': 'id',
    'it': 'it',
    'pl': 'pl',
    'pt': 'pt'
  };
  const langPath = langUrlMap[detectedLang] || 'es';

  // Organize data by modules
  const organizedData = organizeTasksByModules(modulesData, tasksData);
  
  // Get student name
  const studentName = document.querySelector(`a[href="/students/${studentId}"] h3`)?.textContent?.trim() || `Student ${studentId}`;
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'kodland-tasks-modal';
  modal.className = 'kodland-modal';
  
  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.className = 'kodland-modal-content';
  
  // Localized labels
  const labels = {
    title: {
      es: 'Progreso de tareas',
      en: 'Tasks Progress',
      ru: 'Прогресс заданий',
      fr: 'Progression des tâches',
      tr: 'Görev İlerlemesi',
      id: 'Progres Tugas',
      it: 'Avanzamento compiti',
      pl: 'Postęp zadań',
      pt: 'Progresso das tarefas'
    },
    filters: {
      all: { es: 'Todas', en: 'All', ru: 'Все', fr: 'Toutes', tr: 'Tümü', id: 'Semua', it: 'Tutte', pl: 'Wszystkie', pt: 'Todas' },
      submitted: { es: 'Por Calificar', en: 'To Grade', ru: 'На проверке', fr: 'À corriger', tr: 'Notlanacak', id: 'Perlu dinilai', it: 'Da valutare', pl: 'Do oceny', pt: 'Para avaliar' },
      checked: { es: 'Revisadas', en: 'Checked', ru: 'Проверено', fr: 'Corrigées', tr: 'Kontrol edildi', id: 'Sudah diperiksa', it: 'Corrette', pl: 'Sprawdzone', pt: 'Revisadas' },
      notSubmitted: { es: 'No Enviadas', en: 'Not Submitted', ru: 'Не отправлено', fr: 'Non envoyées', tr: 'Gönderilmedi', id: 'Belum dikirim', it: 'Non inviate', pl: 'Nie wysłane', pt: 'Não enviadas' },
      submittedLate: { es: 'Enviadas tarde', en: 'Submitted late', ru: 'Отправлено поздно', fr: 'Envoyées en retard', tr: 'Geç gönderildi', id: 'Terlambat dikirim', it: 'Inviate in ritardo', pl: 'Wysłane po czasie', pt: 'Enviadas tarde' }
    }
  };
  const t = (group, key) => (labels[group]?.[key]?.[detectedLang]) || labels[group]?.[key]?.['es'] || key;

  // Calculate task percentages
  const percentages = calculateTaskPercentages(organizedData);
  
  // Get lessons completed count
  const lessonsCompleted = Object.values(organizedData).reduce((total, module) => {
    return total + module.lessons.length;
  }, 0);
  
  // Modal header
  const header = document.createElement('div');
  header.className = 'kodland-modal-header';
  header.innerHTML = `
    <h2>${t('title', detectedLang)} - ${studentName}</h2>
    <div class="kodland-header-actions">
      <button class="kodland-weekly-summary-btn" title="Enviar resumen semanal">📊</button>
      <button class="kodland-refresh-btn" title="Refresh" ${onRefresh ? '' : 'disabled'}>⟳</button>
      <button class="kodland-modal-close">&times;</button>
    </div>
  `;
  
  // Create filter bar
  const filterBar = document.createElement('div');
  filterBar.className = 'kodland-filter-bar';
  filterBar.innerHTML = `
    <button class="kodland-filter-btn active" data-filter="all">
      <span>${t('filters', 'all')}</span>
      <span class="kodland-filter-count" id="count-all">0</span>
    </button>
    <button class="kodland-filter-btn" data-filter="TASK_SUBMITTED">
      <span>${t('filters', 'submitted')}</span>
      <span class="kodland-filter-count" id="count-submitted">0</span>
    </button>
    <button class="kodland-filter-btn" data-filter="TASK_CHECKED">
      <span>${t('filters', 'checked')}</span>
      <span class="kodland-filter-count" id="count-checked">0</span>
    </button>
    <button class="kodland-filter-btn" data-filter="TASK_NOT_SUBMITTED">
      <span>${t('filters', 'notSubmitted')}</span>
      <span class="kodland-filter-count" id="count-not-submitted">0</span>
    </button>
    <button class="kodland-filter-btn" data-filter="TASK_SUBMITTED_LATE">
      <span>${t('filters', 'submittedLate')}</span>
      <span class="kodland-filter-count" id="count-submitted-late">0</span>
    </button>
  `;
  
  // Modal body
  const body = document.createElement('div');
  body.className = 'kodland-modal-body';
  
  // Helper function to count tasks by status
  function countTasksByStatus(tasksData) {
    const counts = {
      all: 0,
      TASK_SUBMITTED: 0,
      TASK_CHECKED: 0,
      TASK_NOT_SUBMITTED: 0,
      TASK_SUBMITTED_LATE: 0
    };
    
    function countInData(data) {
      if (!data) return;
      
      let tasks = [];
      if (Array.isArray(data)) {
        tasks = data;
      } else if (typeof data === 'object' && data !== null) {
        tasks = data.tasks || data.data || [data];
      }
      
      tasks.forEach(task => {
        counts.all++;
        const statusKey = task.task_status_key || task.status_key || '';
        if (statusKey === 'TASK_SUBMITTED') counts.TASK_SUBMITTED++;
        else if (statusKey === 'TASK_CHECKED') counts.TASK_CHECKED++;
        else if (statusKey === 'TASK_NOT_SUBMITTED') counts.TASK_NOT_SUBMITTED++;
        else if (statusKey === 'TASK_SUBMITTED_LATE') counts.TASK_SUBMITTED_LATE++;
      });
    }
    
    // Count in all lessons
    Object.values(organizedData).forEach(module => {
      module.lessons.forEach(lesson => {
        countInData(lesson.classTasks);
        countInData(lesson.homeworkTasks);
      });
    });
    
    return counts;
  }
  
  // Count tasks and update filter counts
  const taskCounts = countTasksByStatus(tasksData);
  // Note: counts live inside filterBar, so query within filterBar to avoid null
  filterBar.querySelector('#count-all').textContent = taskCounts.all;
  filterBar.querySelector('#count-submitted').textContent = taskCounts.TASK_SUBMITTED;
  filterBar.querySelector('#count-checked').textContent = taskCounts.TASK_CHECKED;
  filterBar.querySelector('#count-not-submitted').textContent = taskCounts.TASK_NOT_SUBMITTED;
  filterBar.querySelector('#count-submitted-late').textContent = taskCounts.TASK_SUBMITTED_LATE;
  
  // Helper function to check if tasks match filter
  function hasMatchingTasks(tasksData, filterStatus) {
    if (!filterStatus) return true; // Show all if no filter
    
    if (!tasksData) return false;
    
    let tasks = [];
    if (Array.isArray(tasksData)) {
      tasks = tasksData;
    } else if (typeof tasksData === 'object' && tasksData !== null) {
      tasks = tasksData.tasks || tasksData.data || [tasksData];
    }
    
    return tasks.some(task => {
      const statusKey = task.task_status_key || task.status_key || '';
      return statusKey === filterStatus;
    });
  }
  
  // Function to render content with filter
  function renderContent(filterStatus = null) {
    body.innerHTML = ''; // Clear body
    
    Object.values(organizedData).forEach((module, moduleIndex) => {
      const lessonsContainer = document.createElement('div');
      lessonsContainer.className = 'kodland-lessons-container';
      
      module.lessons.forEach((lesson, lessonIndex) => {
        // Check if this lesson has matching tasks
        const hasClassTasks = hasMatchingTasks(lesson.classTasks, filterStatus);
        const hasHomeworkTasks = hasMatchingTasks(lesson.homeworkTasks, filterStatus);
        
        // Skip lesson if no matching tasks
        if (!hasClassTasks && !hasHomeworkTasks && filterStatus !== null) {
          return;
        }
        
        const lessonCard = document.createElement('div');
        lessonCard.className = 'kodland-lesson-card';
        
        const lessonHeader = document.createElement('div');
        lessonHeader.className = 'kodland-lesson-header';
        lessonHeader.textContent = `Lesson ${lessonIndex + 1} (ID: ${lesson.id})`;
        lessonCard.appendChild(lessonHeader);
        
        // Class tasks section
        if (lesson.classTasks && hasClassTasks) {
          const classTasksSection = document.createElement('div');
          classTasksSection.className = 'kodland-tasks-section kodland-class-tasks';
          classTasksSection.innerHTML = `<h4>📚 Class Tasks</h4>`;
          
          const classTasksList = renderTasksList(lesson.classTasks, filterStatus, studentId, langPath);
          classTasksSection.appendChild(classTasksList);
          lessonCard.appendChild(classTasksSection);
        }
        
        // Homework tasks section
        if (lesson.homeworkTasks && hasHomeworkTasks) {
          const homeworkTasksSection = document.createElement('div');
          homeworkTasksSection.className = 'kodland-tasks-section kodland-homework-tasks';
          homeworkTasksSection.innerHTML = `<h4>📝 Homework Tasks</h4>`;
          
          const homeworkTasksList = renderTasksList(lesson.homeworkTasks, filterStatus, studentId, langPath);
          homeworkTasksSection.appendChild(homeworkTasksList);
          lessonCard.appendChild(homeworkTasksSection);
        }
        
        if (!lesson.classTasks && !lesson.homeworkTasks) {
          lessonCard.innerHTML += '<p class="kodland-no-tasks">No tasks data available</p>';
        }
        
        lessonsContainer.appendChild(lessonCard);
      });
      
      // Only add module section if it has visible lessons
      if (lessonsContainer.children.length > 0) {
        const moduleSection = document.createElement('div');
        moduleSection.className = 'kodland-module-section';
        moduleSection.innerHTML = `<h3>${module.name}</h3>`;
        moduleSection.appendChild(lessonsContainer);
        body.appendChild(moduleSection);
      }
    });
    
    // Show message if no tasks match filter
    if (body.children.length === 0 && filterStatus !== null) {
      body.innerHTML = '<p class="kodland-no-tasks" style="text-align: center; padding: 40px; font-size: 16px;">No hay tareas que coincidan con este filtro</p>';
    }
  }
  
  // Initial render with no filter
  renderContent(null);
  
  modalContent.appendChild(header);
  modalContent.appendChild(filterBar);
  modalContent.appendChild(body);
  modal.appendChild(modalContent);
  
  // Add to document
  document.body.appendChild(modal);
  
  // Filter button handlers
  const filterButtons = filterBar.querySelectorAll('.kodland-filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Get filter value
      const filterValue = btn.getAttribute('data-filter');
      const filterStatus = filterValue === 'all' ? null : filterValue;
      
      // Re-render content with filter
      renderContent(filterStatus);
    });
  });

  // Weekly summary button handler
  const weeklySummaryBtn = header.querySelector('.kodland-weekly-summary-btn');
  if (weeklySummaryBtn) {
    weeklySummaryBtn.addEventListener('click', async () => {
      try {
        // Alert messages by language
        const alertMessages = {
          es: {
            noStudentData: 'No se pudo obtener la información del estudiante',
            noPhone: 'No se encontró el teléfono del padre',
            error: 'Error al generar el resumen semanal'
          },
          en: {
            noStudentData: 'Could not get student information',
            noPhone: 'Parent phone number not found',
            error: 'Error generating weekly summary'
          },
          ru: {
            noStudentData: 'Не удалось получить информацию об ученике',
            noPhone: 'Телефон родителя не найден',
            error: 'Ошибка при создании еженедельной сводки'
          },
          fr: {
            noStudentData: 'Impossible d\'obtenir les informations de l\'étudiant',
            noPhone: 'Numéro de téléphone du parent introuvable',
            error: 'Erreur lors de la génération du résumé hebdomadaire'
          },
          tr: {
            noStudentData: 'Öğrenci bilgileri alınamadı',
            noPhone: 'Ebeveyn telefon numarası bulunamadı',
            error: 'Haftalık özet oluşturulurken hata'
          },
          id: {
            noStudentData: 'Tidak dapat mendapatkan informasi siswa',
            noPhone: 'Nomor telepon orang tua tidak ditemukan',
            error: 'Kesalahan saat membuat ringkasan mingguan'
          },
          it: {
            noStudentData: 'Impossibile ottenere le informazioni dello studente',
            noPhone: 'Numero di telefono del genitore non trovato',
            error: 'Errore durante la generazione del riepilogo settimanale'
          },
          pl: {
            noStudentData: 'Nie można uzyskać informacji o uczniu',
            noPhone: 'Nie znaleziono numeru telefonu rodzica',
            error: 'Błąd podczas generowania cotygodniowego podsumowania'
          },
          pt: {
            noStudentData: 'Não foi possível obter as informações do estudante',
            noPhone: 'Número de telefone do pai não encontrado',
            error: 'Erro ao gerar o resumo semanal'
          }
        };
        
        const alerts = alertMessages[detectedLang] || alertMessages.es;
        
        // Fetch student data to get parent phone
        const studentData = await fetchStudentInfo(studentId);
        if (!studentData) {
          alert(alerts.noStudentData);
          return;
        }
        
        const parentPhone = studentData.parent_phone || 
                           studentData.parent?.phone || 
                           studentData.parent_phone_number ||
                           studentData.parent?.phone_number ||
                           null;
        
        if (!parentPhone) {
          alert(alerts.noPhone);
          return;
        }
        
        // Generate message
        const message = generateWeeklySummaryMessage(studentName, lessonsCompleted, percentages, detectedLang);
        
        // Format phone for WhatsApp
        const formattedPhone = formatPhoneForWhatsApp(parentPhone);
        const phoneForUrl = formattedPhone.replace(/^\+/, '');
        
        // Encode message for WhatsApp URL
        const encodedMessage = encodeMessageForWhatsApp(message);
        
        // Open WhatsApp
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}&text=${encodedMessage}`;
        window.open(whatsappUrl, '_blank');
        
        console.log('[Group Students Info] Weekly summary sent to parent:', parentPhone);
      } catch (err) {
        console.error('[Group Students Info] Error sending weekly summary:', err);
        const alertMessages = {
          es: 'Error al generar el resumen semanal',
          en: 'Error generating weekly summary',
          ru: 'Ошибка при создании еженедельной сводки',
          fr: 'Erreur lors de la génération du résumé hebdomadaire',
          tr: 'Haftalık özet oluşturulurken hata',
          id: 'Kesalahan saat membuat ringkasan mingguan',
          it: 'Errore durante la generazione del riepilogo settimanale',
          pl: 'Błąd podczas generowania cotygodniowego podsumowania',
          pt: 'Erro ao gerar o resumo semanal'
        };
        alert(alertMessages[detectedLang] || alertMessages.es);
      }
    });
  }
  
  // Refresh button handler
  const refreshBtn = header.querySelector('.kodland-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (!onRefresh) return;
      refreshBtn.disabled = true;
      refreshBtn.classList.add('loading');
      try {
        await onRefresh();
      } catch (err) {
        console.error('[Group Students Info] Error refreshing modal data:', err);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('loading');
      }
    });
  }
  
  // Close button handler
  const closeBtn = modal.querySelector('.kodland-modal-close');
  closeBtn.addEventListener('click', () => {
    modal.remove();
  });
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape' && document.getElementById('kodland-tasks-modal')) {
      modal.remove();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
  
  console.log('[Group Students Info] ✅ Modal displayed');
}

// Function to render tasks list
function renderTasksList(tasksData, filterStatus = null, studentId = null, langPath = 'es') {
  const list = document.createElement('div');
  list.className = 'kodland-tasks-list';
  
  if (!tasksData) {
    list.innerHTML = '<p>No data</p>';
    return list;
  }
  
  // Extract tasks array
  let tasks = [];
  if (Array.isArray(tasksData)) {
    tasks = tasksData;
  } else if (typeof tasksData === 'object' && tasksData !== null) {
    tasks = tasksData.tasks || tasksData.data || [tasksData];
  }
  
  if (tasks.length === 0) {
    list.innerHTML = '<p>No tasks</p>';
    return list;
  }
  
  // Filter tasks based on status
  let filteredTasks = tasks;
  if (filterStatus) {
    filteredTasks = tasks.filter(task => {
      const statusKey = task.task_status_key || task.status_key || '';
      return statusKey === filterStatus;
    });
  }
  
  if (filteredTasks.length === 0) {
    list.innerHTML = '<p class="kodland-no-tasks">No hay tareas con este filtro</p>';
    return list;
  }
  
  // Render filtered tasks
  filteredTasks.forEach((task) => {
    const taskItem = document.createElement('div');
    taskItem.className = 'kodland-task-item';
    taskItem.setAttribute('data-task-status', task.task_status_key || task.status_key || '');
    
    // Use task_title as primary source, fallback to other fields
    const taskName = task.task_title || task.title || task.name || task.task_name || 'Tarea sin nombre';
    const taskStatusKey = task.task_status_key || task.status_key || '';
    const taskStatusValue = task.task_status_value || task.status_value || task.status || 'Desconocido';
    
    // Determine status class based on task_status_key
    let statusClass = 'pending';
    let statusIcon = '○';
    
    if (taskStatusKey === 'TASK_CHECKED') {
      statusClass = 'completed';
      statusIcon = '✓';
    } else if (taskStatusKey === 'TASK_SUBMITTED') {
      statusClass = 'submitted';
      statusIcon = '📤';
    } else if (taskStatusKey === 'TASK_NOT_SUBMITTED') {
      statusClass = 'not-submitted';
      statusIcon = '⏸';
    } else if (taskStatusKey === 'TASK_SUBMITTED_LATE') {
      statusClass = 'submitted-late';
      statusIcon = '⏰';
    } else if (taskStatusKey === 'TASK_NOT_GRADED') {
      statusClass = 'not-graded';
      statusIcon = 'ℹ';
    }
    
    // Show grade if available
    let gradeInfo = '';
    if (task.task_max_grade && task.task_max_grade > 0) {
      const currentGrade = task.task_current_grade || 0;
      gradeInfo = ` <span class="kodland-task-grade">(${currentGrade}/${task.task_max_grade})</span>`;
    }
    
    // Build task link if task_id and studentId are available
    let taskLinkHtml = '';
    if (task.task_id && studentId) {
      const taskUrl = `https://learn.kodland.org/${langPath}/task/${task.task_id}/check/${studentId}`;
      taskLinkHtml = `<a class="kodland-task-link" href="${taskUrl}" target="_blank" rel="noopener noreferrer">↗</a>`;
    }

    taskItem.innerHTML = `
      <div class="kodland-task-info">
        <span class="kodland-task-name">${escapeHtml(taskName)}${gradeInfo}</span>
        <span class="kodland-task-status ${statusClass}">
          ${statusIcon} ${escapeHtml(taskStatusValue)}
        </span>
        ${taskLinkHtml}
      </div>
    `;
    
    list.appendChild(taskItem);
  });
  
  return list;
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Function to format phone number for WhatsApp
function formatPhoneForWhatsApp(phone) {
  if (!phone) return null;
  
  // Remove all non-digit characters except +
  let cleanPhone = phone.replace(/[^\d+]/g, '');
  
  // Remove leading zeros
  cleanPhone = cleanPhone.replace(/^0+/, '');
  
  // Ensure it starts with country code
  if (!cleanPhone.startsWith('+')) {
    // If it doesn't start with +, assume it needs country code
    // You might need to adjust this based on your country
    cleanPhone = '+' + cleanPhone;
  }
  
  return cleanPhone;
}

// Function to get country code from phone number
function getCountryCodeFromPhone(phone) {
  if (!phone) {
    console.warn('[getCountryCodeFromPhone] No phone provided');
    return null;
  }
  
  // Remove all non-digit characters except +
  let cleanPhone = String(phone).replace(/[^\d+]/g, '');
  console.log('[getCountryCodeFromPhone] Cleaned phone:', cleanPhone);
  
  // If it doesn't start with +, try to add it
  if (!cleanPhone.startsWith('+')) {
    // If it's all digits, assume it needs +
    if (/^\d+$/.test(cleanPhone)) {
      cleanPhone = '+' + cleanPhone;
      console.log('[getCountryCodeFromPhone] Added +, new phone:', cleanPhone);
    } else {
      console.warn('[getCountryCodeFromPhone] Phone does not start with + and is not all digits:', cleanPhone);
      return null;
    }
  }
  
  // Extract country code (1-3 digits after +)
  // Try 3 digits first (for codes like 212, 213, etc.), then 2, then 1
  let match = cleanPhone.match(/^\+(\d{3})/);
  if (match) {
    const code = match[1];
    console.log('[getCountryCodeFromPhone] Found 3-digit code:', code);
    return code;
  }
  
  match = cleanPhone.match(/^\+(\d{2})/);
  if (match) {
    const code = match[1];
    console.log('[getCountryCodeFromPhone] Found 2-digit code:', code);
    return code;
  }
  
  match = cleanPhone.match(/^\+(\d{1})/);
  if (match) {
    const code = match[1];
    console.log('[getCountryCodeFromPhone] Found 1-digit code:', code);
    return code;
  }
  
  console.warn('[getCountryCodeFromPhone] Could not extract country code from:', cleanPhone);
  return null;
}

// Function to get country initials from country code
function getCountryInitialsFromPhone(phone) {
  const countryCode = getCountryCodeFromPhone(phone);
  if (!countryCode) return '';
  
  // Map of country codes to country initials
  const countryInitialsMap = {
    '1': 'US', // USA/Canada
    '7': 'RU', // Russia/Kazakhstan
    '20': 'EG', // Egypt
    '27': 'ZA', // South Africa
    '30': 'GR', // Greece
    '31': 'NL', // Netherlands
    '32': 'BE', // Belgium
    '33': 'FR', // France
    '34': 'ES', // Spain
    '39': 'IT', // Italy
    '40': 'RO', // Romania
    '41': 'CH', // Switzerland
    '43': 'AT', // Austria
    '44': 'GB', // UK
    '45': 'DK', // Denmark
    '46': 'SE', // Sweden
    '47': 'NO', // Norway
    '48': 'PL', // Poland
    '49': 'DE', // Germany
    '51': 'PE', // Peru
    '52': 'MX', // Mexico
    '53': 'CU', // Cuba
    '54': 'AR', // Argentina
    '55': 'BR', // Brazil
    '56': 'CL', // Chile
    '57': 'CO', // Colombia
    '58': 'VE', // Venezuela
    '60': 'MY', // Malaysia
    '61': 'AU', // Australia
    '62': 'ID', // Indonesia
    '63': 'PH', // Philippines
    '64': 'NZ', // New Zealand
    '65': 'SG', // Singapore
    '66': 'TH', // Thailand
    '81': 'JP', // Japan
    '82': 'KR', // South Korea
    '84': 'VN', // Vietnam
    '86': 'CN', // China
    '90': 'TR', // Turkey
    '91': 'IN', // India
    '92': 'PK', // Pakistan
    '93': 'AF', // Afghanistan
    '94': 'LK', // Sri Lanka
    '95': 'MM', // Myanmar
    '98': 'IR', // Iran
    '212': 'MA', // Morocco
    '213': 'DZ', // Algeria
    '216': 'TN', // Tunisia
    '218': 'LY', // Libya
    '220': 'GM', // Gambia
    '221': 'SN', // Senegal
    '222': 'MR', // Mauritania
    '223': 'ML', // Mali
    '224': 'GN', // Guinea
    '225': 'CI', // Ivory Coast
    '226': 'BF', // Burkina Faso
    '227': 'NE', // Niger
    '228': 'TG', // Togo
    '229': 'BJ', // Benin
    '230': 'MU', // Mauritius
    '231': 'LR', // Liberia
    '232': 'SL', // Sierra Leone
    '233': 'GH', // Ghana
    '234': 'NG', // Nigeria
    '235': 'TD', // Chad
    '236': 'CF', // Central African Republic
    '237': 'CM', // Cameroon
    '238': 'CV', // Cape Verde
    '239': 'ST', // São Tomé and Príncipe
    '240': 'GQ', // Equatorial Guinea
    '241': 'GA', // Gabon
    '242': 'CG', // Republic of the Congo
    '243': 'CD', // DR Congo
    '244': 'AO', // Angola
    '245': 'GW', // Guinea-Bissau
    '246': 'IO', // British Indian Ocean Territory
    '248': 'SC', // Seychelles
    '249': 'SD', // Sudan
    '250': 'RW', // Rwanda
    '251': 'ET', // Ethiopia
    '252': 'SO', // Somalia
    '253': 'DJ', // Djibouti
    '254': 'KE', // Kenya
    '255': 'TZ', // Tanzania
    '256': 'UG', // Uganda
    '257': 'BI', // Burundi
    '258': 'MZ', // Mozambique
    '260': 'ZM', // Zambia
    '261': 'MG', // Madagascar
    '262': 'RE', // Réunion
    '263': 'ZW', // Zimbabwe
    '264': 'NA', // Namibia
    '265': 'MW', // Malawi
    '266': 'LS', // Lesotho
    '267': 'BW', // Botswana
    '268': 'SZ', // Eswatini
    '269': 'KM', // Comoros
    '290': 'SH', // Saint Helena
    '291': 'ER', // Eritrea
    '297': 'AW', // Aruba
    '298': 'FO', // Faroe Islands
    '299': 'GL', // Greenland
    '350': 'GI', // Gibraltar
    '351': 'PT', // Portugal
    '352': 'LU', // Luxembourg
    '353': 'IE', // Ireland
    '354': 'IS', // Iceland
    '355': 'AL', // Albania
    '356': 'MT', // Malta
    '357': 'CY', // Cyprus
    '358': 'FI', // Finland
    '359': 'BG', // Bulgaria
    '360': 'HU', // Hungary
    '370': 'LT', // Lithuania
    '371': 'LV', // Latvia
    '372': 'EE', // Estonia
    '373': 'MD', // Moldova
    '374': 'AM', // Armenia
    '375': 'BY', // Belarus
    '376': 'AD', // Andorra
    '377': 'MC', // Monaco
    '378': 'SM', // San Marino
    '380': 'UA', // Ukraine
    '381': 'RS', // Serbia
    '382': 'ME', // Montenegro
    '383': 'XK', // Kosovo
    '385': 'HR', // Croatia
    '386': 'SI', // Slovenia
    '387': 'BA', // Bosnia and Herzegovina
    '389': 'MK', // North Macedonia
    '420': 'CZ', // Czech Republic
    '421': 'SK', // Slovakia
    '423': 'LI', // Liechtenstein
    '500': 'FK', // Falkland Islands
    '501': 'BZ', // Belize
    '502': 'GT', // Guatemala
    '503': 'SV', // El Salvador
    '504': 'HN', // Honduras
    '505': 'NI', // Nicaragua
    '506': 'CR', // Costa Rica
    '507': 'PA', // Panama
    '509': 'HT', // Haiti
    '590': 'GP', // Guadeloupe
    '591': 'BO', // Bolivia
    '592': 'GY', // Guyana
    '593': 'EC', // Ecuador
    '594': 'GF', // French Guiana
    '595': 'PY', // Paraguay
    '596': 'MQ', // Martinique
    '597': 'SR', // Suriname
    '598': 'UY', // Uruguay
    '670': 'TL', // East Timor
    '672': 'AQ', // Antarctica
    '673': 'BN', // Brunei
    '674': 'NR', // Nauru
    '675': 'PG', // Papua New Guinea
    '676': 'TO', // Tonga
    '677': 'SB', // Solomon Islands
    '678': 'VU', // Vanuatu
    '679': 'FJ', // Fiji
    '680': 'PW', // Palau
    '681': 'WF', // Wallis and Futuna
    '682': 'CK', // Cook Islands
    '683': 'NU', // Niue
    '684': 'AS', // American Samoa
    '685': 'WS', // Samoa
    '686': 'KI', // Kiribati
    '687': 'NC', // New Caledonia
    '688': 'TV', // Tuvalu
    '689': 'PF', // French Polynesia
    '690': 'TK', // Tokelau
    '691': 'FM', // Micronesia
    '692': 'MH', // Marshall Islands
    '850': 'KP', // North Korea
    '852': 'HK', // Hong Kong
    '853': 'MO', // Macau
    '855': 'KH', // Cambodia
    '856': 'LA', // Laos
    '880': 'BD', // Bangladesh
    '886': 'TW', // Taiwan
    '960': 'MV', // Maldives
    '961': 'LB', // Lebanon
    '962': 'JO', // Jordan
    '963': 'SY', // Syria
    '964': 'IQ', // Iraq
    '965': 'KW', // Kuwait
    '966': 'SA', // Saudi Arabia
    '967': 'YE', // Yemen
    '968': 'OM', // Oman
    '970': 'PS', // Palestine
    '971': 'AE', // UAE
    '972': 'IL', // Israel
    '973': 'BH', // Bahrain
    '974': 'QA', // Qatar
    '975': 'BT', // Bhutan
    '976': 'MN', // Mongolia
    '977': 'NP', // Nepal
    '992': 'TJ', // Tajikistan
    '993': 'TM', // Turkmenistan
    '994': 'AZ', // Azerbaijan
    '995': 'GE', // Georgia
    '996': 'KG', // Kyrgyzstan
    '998': 'UZ'  // Uzbekistan
  };
  
  console.log(`[getCountryInitialsFromPhone] Looking for country code: "${countryCode}" (type: ${typeof countryCode}, length: ${countryCode.length})`);
  
  // Try exact match first (string key)
  const codeStr = String(countryCode);
  if (countryInitialsMap.hasOwnProperty(codeStr)) {
    const initials = countryInitialsMap[codeStr];
    console.log(`[getCountryInitialsFromPhone] ✅ Found exact match for "${codeStr}": ${initials}`);
    return initials;
  }
  
  // Try 3-digit match first
  if (codeStr.length === 3) {
    if (countryInitialsMap.hasOwnProperty(codeStr)) {
      const initials = countryInitialsMap[codeStr];
      console.log(`[getCountryInitialsFromPhone] ✅ Found 3-digit match for "${codeStr}": ${initials}`);
      return initials;
    }
  }
  
  // Try 2-digit match
  if (codeStr.length >= 2) {
    const twoDigit = codeStr.substring(0, 2);
    if (countryInitialsMap.hasOwnProperty(twoDigit)) {
      const initials = countryInitialsMap[twoDigit];
      console.log(`[getCountryInitialsFromPhone] ✅ Found 2-digit match for "${twoDigit}": ${initials}`);
      return initials;
    }
  }
  
  // Try 1-digit match
  if (codeStr.length >= 1) {
    const oneDigit = codeStr.substring(0, 1);
    if (countryInitialsMap.hasOwnProperty(oneDigit)) {
      const initials = countryInitialsMap[oneDigit];
      console.log(`[getCountryInitialsFromPhone] ✅ Found 1-digit match for "${oneDigit}": ${initials}`);
      return initials;
    }
  }
  
  console.warn(`[getCountryInitialsFromPhone] ❌ No initials found for country code: "${codeStr}"`);
  return '';
}

// Function to get country flag emoji from country code (kept for reference but not used)
function getCountryFlagFromPhone(phone) {
  const countryCode = getCountryCodeFromPhone(phone);
  if (!countryCode) return '';
  
  // Map of country codes to flag emojis
  // Using Unicode Regional Indicator Symbols for flags
  const countryCodeMap = {
    '1': '🇺🇸', // USA/Canada
    '7': '🇷🇺', // Russia/Kazakhstan
    '20': '🇪🇬', // Egypt
    '27': '🇿🇦', // South Africa
    '30': '🇬🇷', // Greece
    '31': '🇳🇱', // Netherlands
    '32': '🇧🇪', // Belgium
    '33': '🇫🇷', // France
    '34': '🇪🇸', // Spain
    '39': '🇮🇹', // Italy
    '40': '🇷🇴', // Romania
    '41': '🇨🇭', // Switzerland
    '43': '🇦🇹', // Austria
    '44': '🇬🇧', // UK
    '45': '🇩🇰', // Denmark
    '46': '🇸🇪', // Sweden
    '47': '🇳🇴', // Norway
    '48': '🇵🇱', // Poland
    '49': '🇩🇪', // Germany
    '51': '🇵🇪', // Peru
    '52': '🇲🇽', // Mexico
    '53': '🇨🇺', // Cuba
    '54': '🇦🇷', // Argentina
    '55': '🇧🇷', // Brazil
    '56': '🇨🇱', // Chile
    '57': '🇨🇴', // Colombia
    '58': '🇻🇪', // Venezuela
    '60': '🇲🇾', // Malaysia
    '61': '🇦🇺', // Australia
    '62': '🇮🇩', // Indonesia
    '63': '🇵🇭', // Philippines
    '64': '🇳🇿', // New Zealand
    '65': '🇸🇬', // Singapore
    '66': '🇹🇭', // Thailand
    '81': '🇯🇵', // Japan
    '82': '🇰🇷', // South Korea
    '84': '🇻🇳', // Vietnam
    '86': '🇨🇳', // China
    '90': '🇹🇷', // Turkey
    '91': '🇮🇳', // India
    '92': '🇵🇰', // Pakistan
    '93': '🇦🇫', // Afghanistan
    '94': '🇱🇰', // Sri Lanka
    '95': '🇲🇲', // Myanmar
    '98': '🇮🇷', // Iran
    '212': '🇲🇦', // Morocco
    '213': '🇩🇿', // Algeria
    '216': '🇹🇳', // Tunisia
    '218': '🇱🇾', // Libya
    '220': '🇬🇲', // Gambia
    '221': '🇸🇳', // Senegal
    '222': '🇲🇷', // Mauritania
    '223': '🇲🇱', // Mali
    '224': '🇬🇳', // Guinea
    '225': '🇨🇮', // Ivory Coast
    '226': '🇧🇫', // Burkina Faso
    '227': '🇳🇪', // Niger
    '228': '🇹🇬', // Togo
    '229': '🇧🇯', // Benin
    '230': '🇲🇺', // Mauritius
    '231': '🇱🇷', // Liberia
    '232': '🇸🇱', // Sierra Leone
    '233': '🇬🇭', // Ghana
    '234': '🇳🇬', // Nigeria
    '235': '🇹🇩', // Chad
    '236': '🇨🇫', // Central African Republic
    '237': '🇨🇲', // Cameroon
    '238': '🇨🇻', // Cape Verde
    '239': '🇸🇹', // São Tomé and Príncipe
    '240': '🇬🇶', // Equatorial Guinea
    '241': '🇬🇦', // Gabon
    '242': '🇨🇬', // Republic of the Congo
    '243': '🇨🇩', // DR Congo
    '244': '🇦🇴', // Angola
    '245': '🇬🇼', // Guinea-Bissau
    '246': '🇮🇴', // British Indian Ocean Territory
    '248': '🇸🇨', // Seychelles
    '249': '🇸🇩', // Sudan
    '250': '🇷🇼', // Rwanda
    '251': '🇪🇹', // Ethiopia
    '252': '🇸🇴', // Somalia
    '253': '🇩🇯', // Djibouti
    '254': '🇰🇪', // Kenya
    '255': '🇹🇿', // Tanzania
    '256': '🇺🇬', // Uganda
    '257': '🇧🇮', // Burundi
    '258': '🇲🇿', // Mozambique
    '260': '🇿🇲', // Zambia
    '261': '🇲🇬', // Madagascar
    '262': '🇷🇪', // Réunion
    '263': '🇿🇼', // Zimbabwe
    '264': '🇳🇦', // Namibia
    '265': '🇲🇼', // Malawi
    '266': '🇱🇸', // Lesotho
    '267': '🇧🇼', // Botswana
    '268': '🇸🇿', // Eswatini
    '269': '🇰🇲', // Comoros
    '290': '🇸🇭', // Saint Helena
    '291': '🇪🇷', // Eritrea
    '297': '🇦🇼', // Aruba
    '298': '🇫🇴', // Faroe Islands
    '299': '🇬🇱', // Greenland
    '350': '🇬🇮', // Gibraltar
    '351': '🇵🇹', // Portugal
    '352': '🇱🇺', // Luxembourg
    '353': '🇮🇪', // Ireland
    '354': '🇮🇸', // Iceland
    '355': '🇦🇱', // Albania
    '356': '🇲🇹', // Malta
    '357': '🇨🇾', // Cyprus
    '358': '🇫🇮', // Finland
    '359': '🇧🇬', // Bulgaria
    '360': '🇭🇺', // Hungary
    '370': '🇱🇹', // Lithuania
    '371': '🇱🇻', // Latvia
    '372': '🇪🇪', // Estonia
    '373': '🇲🇩', // Moldova
    '374': '🇦🇲', // Armenia
    '375': '🇧🇾', // Belarus
    '376': '🇦🇩', // Andorra
    '377': '🇲🇨', // Monaco
    '378': '🇸🇲', // San Marino
    '380': '🇺🇦', // Ukraine
    '381': '🇷🇸', // Serbia
    '382': '🇲🇪', // Montenegro
    '383': '🇽🇰', // Kosovo
    '385': '🇭🇷', // Croatia
    '386': '🇸🇮', // Slovenia
    '387': '🇧🇦', // Bosnia and Herzegovina
    '389': '🇲🇰', // North Macedonia
    '420': '🇨🇿', // Czech Republic
    '421': '🇸🇰', // Slovakia
    '423': '🇱🇮', // Liechtenstein
    '500': '🇫🇰', // Falkland Islands
    '501': '🇧🇿', // Belize
    '502': '🇬🇹', // Guatemala
    '503': '🇸🇻', // El Salvador
    '504': '🇭🇳', // Honduras
    '505': '🇳🇮', // Nicaragua
    '506': '🇨🇷', // Costa Rica
    '507': '🇵🇦', // Panama
    '509': '🇭🇹', // Haiti
    '590': '🇬🇵', // Guadeloupe
    '591': '🇧🇴', // Bolivia
    '592': '🇬🇾', // Guyana
    '593': '🇪🇨', // Ecuador
    '594': '🇬🇫', // French Guiana
    '595': '🇵🇾', // Paraguay
    '596': '🇲🇶', // Martinique
    '597': '🇸🇷', // Suriname
    '598': '🇺🇾', // Uruguay
    '670': '🇹🇱', // East Timor
    '672': '🇦🇶', // Antarctica
    '673': '🇧🇳', // Brunei
    '674': '🇳🇷', // Nauru
    '675': '🇵🇬', // Papua New Guinea
    '676': '🇹🇴', // Tonga
    '677': '🇸🇧', // Solomon Islands
    '678': '🇻🇺', // Vanuatu
    '679': '🇫🇯', // Fiji
    '680': '🇵🇼', // Palau
    '681': '🇼🇫', // Wallis and Futuna
    '682': '🇨🇰', // Cook Islands
    '683': '🇳🇺', // Niue
    '684': '🇦🇸', // American Samoa
    '685': '🇼🇸', // Samoa
    '686': '🇰🇮', // Kiribati
    '687': '🇳🇨', // New Caledonia
    '688': '🇹🇻', // Tuvalu
    '689': '🇵🇫', // French Polynesia
    '690': '🇹🇰', // Tokelau
    '691': '🇫🇲', // Micronesia
    '692': '🇲🇭', // Marshall Islands
    '850': '🇰🇵', // North Korea
    '852': '🇭🇰', // Hong Kong
    '853': '🇲🇴', // Macau
    '855': '🇰🇭', // Cambodia
    '856': '🇱🇦', // Laos
    '880': '🇧🇩', // Bangladesh
    '886': '🇹🇼', // Taiwan
    '960': '🇲🇻', // Maldives
    '961': '🇱🇧', // Lebanon
    '962': '🇯🇴', // Jordan
    '963': '🇸🇾', // Syria
    '964': '🇮🇶', // Iraq
    '965': '🇰🇼', // Kuwait
    '966': '🇸🇦', // Saudi Arabia
    '967': '🇾🇪', // Yemen
    '968': '🇴🇲', // Oman
    '970': '🇵🇸', // Palestine
    '971': '🇦🇪', // UAE
    '972': '🇮🇱', // Israel
    '973': '🇧🇭', // Bahrain
    '974': '🇶🇦', // Qatar
    '975': '🇧🇹', // Bhutan
    '976': '🇲🇳', // Mongolia
    '977': '🇳🇵', // Nepal
    '992': '🇹🇯', // Tajikistan
    '993': '🇹🇲', // Turkmenistan
    '994': '🇦🇿', // Azerbaijan
    '995': '🇬🇪', // Georgia
    '996': '🇰🇬', // Kyrgyzstan
    '998': '🇺🇿'  // Uzbekistan
  };
  
  console.log(`[getCountryFlagFromPhone] Looking for country code: "${countryCode}" (type: ${typeof countryCode}, length: ${countryCode.length})`);
  console.log(`[getCountryFlagFromPhone] Available keys in map:`, Object.keys(countryCodeMap).slice(0, 20));
  
  // Try exact match first (string key)
  const codeStr = String(countryCode);
  if (countryCodeMap.hasOwnProperty(codeStr)) {
    const flag = countryCodeMap[codeStr];
    console.log(`[getCountryFlagFromPhone] ✅ Found exact match for "${codeStr}": ${flag}`);
    return flag;
  }
  
  // Try 3-digit match first (for codes like 212, 213, 593, etc.)
  if (codeStr.length === 3) {
    if (countryCodeMap.hasOwnProperty(codeStr)) {
      const flag = countryCodeMap[codeStr];
      console.log(`[getCountryFlagFromPhone] ✅ Found 3-digit match for "${codeStr}": ${flag}`);
      return flag;
    }
  }
  
  // Try 2-digit match for codes like 20, 27, 59, etc.
  if (codeStr.length >= 2) {
    const twoDigit = codeStr.substring(0, 2);
    if (countryCodeMap.hasOwnProperty(twoDigit)) {
      const flag = countryCodeMap[twoDigit];
      console.log(`[getCountryFlagFromPhone] ✅ Found 2-digit match for "${twoDigit}": ${flag}`);
      return flag;
    }
  }
  
  // Try 1-digit match for codes like 1, 7
  if (codeStr.length >= 1) {
    const oneDigit = codeStr.substring(0, 1);
    if (countryCodeMap.hasOwnProperty(oneDigit)) {
      const flag = countryCodeMap[oneDigit];
      console.log(`[getCountryFlagFromPhone] ✅ Found 1-digit match for "${oneDigit}": ${flag}`);
      return flag;
    }
  }
  
  console.warn(`[getCountryFlagFromPhone] ❌ No flag found for country code: "${codeStr}"`);
  console.warn(`[getCountryFlagFromPhone] Tried: "${codeStr}", "${codeStr.length >= 2 ? codeStr.substring(0, 2) : ''}", "${codeStr.length >= 1 ? codeStr.substring(0, 1) : ''}"`);
  return '';
}

// Function to encode message for WhatsApp URL
function encodeMessageForWhatsApp(text) {
  if (!text) return '';
  
  // Normalize line breaks
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // encodeURIComponent properly handles UTF-8 encoding, including emojis
  // It converts Unicode characters to percent-encoded UTF-8 bytes
  let encoded = encodeURIComponent(normalized);
  
  // Replace spaces with + for URL encoding (WhatsApp format)
  encoded = encoded.replace(/%20/g, '+');
  
  return encoded;
}

// Store student credentials by ID
const studentCredentialsCache = {};

// Cache of full student general-info responses, keyed by studentId.
// Populated as students are processed on the group page; used later
// to export contacts to CSV without re-fetching everything.
const studentGeneralInfoCache = {};

// Function to get student credentials (username/password)
async function getStudentCredentials(studentId) {
  // Check cache first
  if (studentCredentialsCache[studentId]) {
    return studentCredentialsCache[studentId];
  }

  // Reuse the general-info response already fetched for this student (e.g.
  // by processAllStudents when the group page loaded) instead of hitting
  // the same API endpoint a second time. Only fetch if we truly don't have
  // it cached anywhere yet.
  let data = studentGeneralInfoCache[studentId] || null;

  if (!data) {
    data = await fetchStudentInfo(studentId);
    if (data) studentGeneralInfoCache[studentId] = data;
  }

  if (!data) return null;

  try {
    // Try to extract credentials from response
    // Look for student_login and student_password specifically (as mentioned by user)
    const username = data.student_login || 
                    data.student_user || 
                    data.student_username || 
                    data.username || 
                    data.login || 
                    data.user_name || 
                    data.user_login || '';
    
    const password = data.student_password || 
                    data.student_pass || 
                    data.password || 
                    data.user_password || 
                    data.pass || '';
    
    console.log(`[Group Students Info] Extracted credentials for student ${studentId}:`, {
      username: username ? `${username.substring(0, 3)}...` : 'NOT FOUND',
      password: password ? '***' : 'NOT FOUND',
      availableFields: Object.keys(data).filter(k => k.toLowerCase().includes('login') || k.toLowerCase().includes('password') || k.toLowerCase().includes('user') || k.toLowerCase().includes('pass'))
    });
    
    if (username && password) {
      const credentials = {
        username: username,
        password: password,
        formatted: `Usuario: ${username}\nContraseña: ${password}`
      };
      studentCredentialsCache[studentId] = credentials;
      console.log(`[Group Students Info] ✅ Credentials found and cached for student ${studentId}`);
      return credentials;
    } else {
      console.warn(`[Group Students Info] ⚠️ Missing credentials for student ${studentId}:`, {
        hasUsername: !!username,
        hasPassword: !!password,
        dataKeys: Object.keys(data)
      });
    }
    
    // Try other possible structures
    if (data.credentials) {
      const creds = typeof data.credentials === 'string' 
        ? { formatted: data.credentials, username: '', password: '' }
        : { formatted: data.credentials, ...data.credentials };
      studentCredentialsCache[studentId] = creds;
      return creds;
    }
    
    if (data.login_info) {
      const loginInfo = data.login_info;
      const username = loginInfo.student_user || loginInfo.username || loginInfo.login || '';
      const password = loginInfo.student_password || loginInfo.password || loginInfo.pass || '';
      const creds = {
        username: username,
        password: password,
        formatted: `Usuario: ${username}\nContraseña: ${password}`
      };
      studentCredentialsCache[studentId] = creds;
      return creds;
    }
  } catch (error) {
    console.error(`[Group Students Info] Error extracting credentials for student ${studentId}:`, error);
  }
  
  // If credentials not found, return null to trigger fallback
  return null;
}

// Function to generate the "student didn't connect to class" message.
// Personalized with the student's name, the tutor's name (from settings),
// and the course name. Currently only Spanish text is provided; falls back
// to Spanish for any other detected page language.
function generateAbsenceMessage(language = 'es', { studentName, tutorName, courseName } = {}) {
  const settings = getExtensionSettings();
  const resolvedTutorName = tutorName || settings.tutorName || 'tu tutor';
  const template = settings.absenceTemplate || DEFAULT_ABSENCE_TEMPLATE;

  // Only Spanish is supported today; other languages fall back to Spanish.
  return renderTemplate(template, {
    studentName: studentName || '',
    tutorName: resolvedTutorName,
    courseName: courseName || ''
  });
}

// Function to find course name using XPath
function findCourseName() {
  const xpath = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div[1]/div[1]/div[2]/div[2]/div[2]/div/div/div[1]/div/div/span/a';
  
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    const element = result.singleNodeValue;
    if (element) {
      const fullText = element.textContent?.trim() || element.innerText?.trim() || '';
      console.log('[Group Students Info] Full course text found:', fullText);
      
      // Extract course name between ID and next bracketed field
      // Format examples: "[1210] Roblox Game Developer [2024]..." (with spaces)
      //                or "[1354]Creatividad digital. Nivel 1[None]..." (no spaces)
      // We want just: "Roblox Game Developer" / "Creatividad digital. Nivel 1"
      const match = fullText.match(/\]\s*(.+?)\s*\[/);
      if (match && match[1]) {
        const courseName = match[1].trim();
        console.log('[Group Students Info] Extracted course name:', courseName);
        return courseName;
      } else {
        // Fallback: if pattern doesn't match, return the full text
        console.warn('[Group Students Info] Could not extract course name from pattern, using full text');
        return fullText;
      }
    }
  } catch (error) {
    console.warn('[Group Students Info] Error finding course name:', error);
  }

  // Fallback: the XPath is brittle (breaks with layout changes). If it
  // didn't find anything but we already have the group's general info
  // cached (fetched on group page load), use course.title from there -
  // same "[id] Name [year]..." format, so we reuse the same regex.
  const groupId = extractGroupId();
  const cachedInfo = groupId ? getCachedGroupGeneralInfo(groupId) : null;
  const apiCourseTitle = cachedInfo?.course?.title;
  if (apiCourseTitle) {
    const match = apiCourseTitle.match(/\]\s*(.+?)\s*\[/);
    const courseName = match && match[1] ? match[1].trim() : apiCourseTitle;
    console.log('[Group Students Info] Course name from API fallback:', courseName);
    return courseName;
  }

  return '';
}

// Function to detect page language
function detectPageLanguage() {
  // Look for the active language item in the language selector
  try {
    const activeLangItem = document.querySelector('.v-list-item--active .v-list-item-title');
    if (activeLangItem) {
      const langText = activeLangItem.textContent?.trim() || '';
      console.log('[Group Students Info] Detected language:', langText);
      
      // Map language names to codes
      const langMap = {
        'Русский': 'ru',
        'English': 'en',
        'French': 'fr',
        'Turkish': 'tr',
        'Español': 'es',
        'Indonesian': 'id',
        'Italian': 'it',
        'Polish': 'pl',
        'Portuguese': 'pt'
      };
      
      return langMap[langText] || 'es'; // Default to Spanish
    }
  } catch (error) {
    console.warn('[Group Students Info] Error detecting language:', error);
  }
  
  // Fallback: check document language
  const htmlLang = document.documentElement.lang || 'es';
  return htmlLang.substring(0, 2).toLowerCase();
}

// Function to get button tooltips based on language
function getButtonTooltips(language = 'es') {
  const tooltips = {
    'es': {
      openWA: 'Abrir WhatsApp',
      welcomeMessage: 'Mensaje de Bienvenida',
      modulesProgress: 'Progreso de Módulos'
    },
    'en': {
      openWA: 'Open WhatsApp',
      welcomeMessage: 'Welcome Message',
      modulesProgress: 'Modules Progress'
    },
    'ru': {
      openWA: 'Открыть WhatsApp',
      welcomeMessage: 'Приветственное сообщение',
      modulesProgress: 'Прогресс модулей'
    },
    'fr': {
      openWA: 'Ouvrir WhatsApp',
      welcomeMessage: 'Message de bienvenue',
      modulesProgress: 'Progrès des modules'
    },
    'tr': {
      openWA: 'WhatsApp\'ı Aç',
      welcomeMessage: 'Hoş Geldin Mesajı',
      modulesProgress: 'Modül İlerlemesi'
    },
    'id': {
      openWA: 'Buka WhatsApp',
      welcomeMessage: 'Pesan Selamat Datang',
      modulesProgress: 'Kemajuan Modul'
    },
    'it': {
      openWA: 'Apri WhatsApp',
      welcomeMessage: 'Messaggio di benvenuto',
      modulesProgress: 'Progresso Moduli'
    },
    'pl': {
      openWA: 'Otwórz WhatsApp',
      welcomeMessage: 'Wiadomość powitalna',
      modulesProgress: 'Postęp modułów'
    },
    'pt': {
      openWA: 'Abrir WhatsApp',
      welcomeMessage: 'Mensagem de Boas-vindas',
      modulesProgress: 'Progresso dos Módulos'
    }
  };
  
  return tooltips[language] || tooltips['es'];
}

// Function to create welcome message with credentials
function createWelcomeMessage(studentName, credentials, courseName = '', language = 'es') {
  // credentials can be an object with username/password or a formatted string
  const credsText = typeof credentials === 'object' && credentials.formatted 
    ? credentials.formatted 
    : (typeof credentials === 'object' && credentials.username && credentials.password
      ? (language === 'es' 
        ? `Usuario: ${credentials.username}\nContraseña: ${credentials.password}`
        : language === 'en'
        ? `Username: ${credentials.username}\nPassword: ${credentials.password}`
        : language === 'ru'
        ? `Пользователь: ${credentials.username}\nПароль: ${credentials.password}`
        : `Usuario: ${credentials.username}\nContraseña: ${credentials.password}`)
      : credentials);
  
  // Use emojis as Unicode code points to ensure proper encoding
  // 👋 = U+1F44B, 🚀 = U+1F680
  // Convert to actual emoji characters
  const waveEmoji = String.fromCodePoint(0x1F44B); // 👋
  const rocketEmoji = String.fromCodePoint(0x1F680); // 🚀
  
  // Messages in different languages
  const messages = {
    'es': {
      greeting: '¡Hola!',
      welcome: courseName 
        ? `Bienvenido/a al curso ${courseName} de Kodland, ${studentName}!`
        : `Bienvenido/a al curso de Kodland, ${studentName}!`,
      credentials: 'Aquí están tus credenciales de acceso:',
      loginLink: 'Ingresa tus credenciales en:',
      closing: '¡Esperamos que disfrutes aprendiendo con nosotros!'
    },
    'en': {
      greeting: 'Hello!',
      welcome: courseName
        ? `Welcome to the ${courseName} course at Kodland, ${studentName}!`
        : `Welcome to Kodland course, ${studentName}!`,
      credentials: 'Here are your login credentials:',
      loginLink: 'Enter your credentials at:',
      closing: 'We hope you enjoy learning with us!'
    },
    'ru': {
      greeting: 'Привет!',
      welcome: courseName
        ? `Добро пожаловать на курс ${courseName} в Kodland, ${studentName}!`
        : `Добро пожаловать на курс Kodland, ${studentName}!`,
      credentials: 'Вот ваши учетные данные для входа:',
      loginLink: 'Введите свои учетные данные на:',
      closing: 'Надеемся, вам понравится учиться с нами!'
    },
    'fr': {
      greeting: 'Bonjour!',
      welcome: courseName
        ? `Bienvenue au cours ${courseName} de Kodland, ${studentName}!`
        : `Bienvenue au cours de Kodland, ${studentName}!`,
      credentials: 'Voici vos identifiants de connexion:',
      loginLink: 'Entrez vos identifiants sur:',
      closing: 'Nous espérons que vous apprécierez d\'apprendre avec nous!'
    },
    'tr': {
      greeting: 'Merhaba!',
      welcome: courseName
        ? `Kodland'taki ${courseName} kursuna hoş geldiniz, ${studentName}!`
        : `Kodland kursuna hoş geldiniz, ${studentName}!`,
      credentials: 'İşte giriş bilgileriniz:',
      loginLink: 'Bilgilerinizi şu adrese girin:',
      closing: 'Bizimle öğrenmekten keyif almanızı umuyoruz!'
    },
    'id': {
      greeting: 'Halo!',
      welcome: courseName
        ? `Selamat datang di kursus ${courseName} di Kodland, ${studentName}!`
        : `Selamat datang di kursus Kodland, ${studentName}!`,
      credentials: 'Berikut kredensial login Anda:',
      loginLink: 'Masukkan kredensial Anda di:',
      closing: 'Kami harap Anda menikmati belajar bersama kami!'
    },
    'it': {
      greeting: 'Ciao!',
      welcome: courseName
        ? `Benvenuto/a al corso ${courseName} di Kodland, ${studentName}!`
        : `Benvenuto/a al corso di Kodland, ${studentName}!`,
      credentials: 'Ecco le tue credenziali di accesso:',
      loginLink: 'Inserisci le tue credenziali su:',
      closing: 'Speriamo che ti piaccia imparare con noi!'
    },
    'pl': {
      greeting: 'Cześć!',
      welcome: courseName
        ? `Witamy na kursie ${courseName} w Kodland, ${studentName}!`
        : `Witamy na kursie Kodland, ${studentName}!`,
      credentials: 'Oto twoje dane logowania:',
      loginLink: 'Wprowadź swoje dane logowania na:',
      closing: 'Mamy nadzieję, że spodoba Ci się nauka z nami!'
    },
    'pt': {
      greeting: 'Olá!',
      welcome: courseName
        ? `Bem-vindo/a ao curso ${courseName} da Kodland, ${studentName}!`
        : `Bem-vindo/a ao curso da Kodland, ${studentName}!`,
      credentials: 'Aqui estão suas credenciais de acesso:',
      loginLink: 'Digite suas credenciais em:',
      closing: 'Esperamos que você goste de aprender conosco!'
    }
  };
  
  // Map language codes to URL paths
  const langUrlMap = {
    'es': 'es',
    'en': 'en',
    'ru': 'ru',
    'fr': 'fr',
    'tr': 'tr',
    'id': 'id',
    'it': 'it',
    'pl': 'pl',
    'pt': 'pt'
  };
  
  // Get URL path for current language, default to Spanish
  const langPath = langUrlMap[language] || 'es';
  const loginUrl = `https://learn.kodland.org/${langPath}/auth`;
  
  // Get message for current language, fallback to Spanish
  const msg = messages[language] || messages['es'];
  
  // Return plain text with emojis (will be encoded by encodeMessageForWhatsApp)
  return `${msg.greeting} ${waveEmoji}

${msg.welcome}

${msg.credentials}
${credsText}

${msg.loginLink}
${loginUrl}

${msg.closing} ${rocketEmoji}`;
}

// Extract just the student's name from their container, stripping the
// "[XX]" country-code badge that's prepended inside the same <h3>.
function extractStudentName(container) {
  const h3 = container?.querySelector('h3');
  if (!h3) return 'Estudiante';
  const clone = h3.cloneNode(true);
  const countrySpan = clone.querySelector('.kodland-country-initials');
  if (countrySpan) countrySpan.remove();
  return clone.textContent.trim() || 'Estudiante';
}

// Function to find the nearest lesson from schedule data
function findNearestLesson(scheduleData) {
  if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
    return null;
  }
  
  const now = new Date();
  const nowTime = now.getTime();
  
  // Filter lessons that are today or in the future, and sort by time
  const upcomingLessons = scheduleData
    .filter(lesson => {
      if (!lesson.timetable_time) return false;
      const lessonTime = new Date(lesson.timetable_time).getTime();
      // Include lessons from 15 minutes ago (in case class just started)
      const fifteenMinutesAgo = nowTime - (15 * 60 * 1000);
      return lessonTime >= fifteenMinutesAgo;
    })
    .sort((a, b) => {
      const timeA = new Date(a.timetable_time).getTime();
      const timeB = new Date(b.timetable_time).getTime();
      return timeA - timeB;
    });
  
  if (upcomingLessons.length === 0) {
    return null;
  }
  
  return upcomingLessons[0];
}

// Find the very first lesson (M1L1) from schedule data - the earliest by date,
// regardless of whether it's already past. Used for the welcome message,
// which should reference the course's actual start date, not "whatever
// lesson is coming up next".
function findFirstLesson(scheduleData) {
  if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
    return null;
  }

  const withTime = scheduleData.filter(lesson => lesson.timetable_time);
  if (withTime.length === 0) return null;

  return withTime.reduce((earliest, lesson) =>
    new Date(lesson.timetable_time) < new Date(earliest.timetable_time) ? lesson : earliest
  );
}

// Find the very LAST lesson (the final class, often graduation day) from
// schedule data - the latest by date. Used to suggest a default date/time
// for the graduation broadcast message.
function findLastLesson(scheduleData) {
  if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
    return null;
  }

  const withTime = scheduleData.filter(lesson => lesson.timetable_time);
  if (withTime.length === 0) return null;

  return withTime.reduce((latest, lesson) =>
    new Date(lesson.timetable_time) > new Date(latest.timetable_time) ? lesson : latest
  );
}

// Find the most recent lesson that has ALREADY happened (as opposed to
// findLastLesson, which finds the last lesson of the whole course by date,
// even if that's still in the future). This is what "grabación de la
// última clase" actually means.
function findMostRecentPastLesson(scheduleData) {
  if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) {
    return null;
  }

  const now = Date.now();
  const pastLessons = scheduleData.filter(lesson =>
    lesson.timetable_time && new Date(lesson.timetable_time).getTime() <= now
  );
  if (pastLessons.length === 0) return null;

  return pastLessons.reduce((latest, lesson) =>
    new Date(lesson.timetable_time) > new Date(latest.timetable_time) ? lesson : latest
  );
}

async function fetchLastPastLessonForGroup(groupId) {
  try {
    const apiUrl = `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/schedule_view/`;
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(apiUrl, { method: 'GET', credentials: 'include', headers });
    if (!response.ok) return null;

    const scheduleData = await response.json();
    return findMostRecentPastLesson(scheduleData);
  } catch (error) {
    console.error(`[Schedule] Error fetching last past lesson for group ${groupId}:`, error);
    return null;
  }
}

// The recording link isn't part of the schedule_view API response - it
// lives in the "Horario" tab's UI (?tab=2 on the group page). Each
// completed lesson row has a "Grabaciones de la clase" toggle
// (.zoom-records-cell a) that expands a card showing either an
// "Enlace - S3" link or a "No hay grabaciones disponibles" message.
//
// If that tab happens to already be rendered in the page (the tutor
// visited it earlier this session and Vue kept it mounted), we can read
// it directly instead of making the tutor go find it by hand.
async function scrapeRecordingLinkFromScheduleDOM() {
  const rows = Array.from(document.querySelectorAll('.schedule-slot'));
  if (rows.length === 0) return null; // schedule tab isn't rendered right now

  // Completed lessons only, most recent first (rows are in chronological
  // order in the DOM, so reversing gives us newest-first).
  const completedRows = rows.filter(row => {
    const statusBtn = row.querySelector('.classroom-cell button');
    return statusBtn && /completado/i.test(statusBtn.textContent || '');
  }).reverse();

  for (const row of completedRows) {
    const recordsToggle = row.querySelector('.zoom-records-cell a');
    const expansionCard = row.nextElementSibling;
    if (!recordsToggle || !expansionCard) continue;

    const isCollapsed = () =>
      expansionCard.style.display === 'none' || getComputedStyle(expansionCard).display === 'none';

    if (isCollapsed()) {
      recordsToggle.click();
      for (let i = 0; i < 15 && isCollapsed(); i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // The card can become visible before Vue has actually populated its
    // contents, so poll briefly for either a real link or the "no
    // recordings" message before deciding this lesson has nothing.
    let link = null;
    let confirmedEmpty = false;
    for (let i = 0; i < 15; i++) {
      const anchor = expansionCard.querySelector('.record-list a[href]');
      if (anchor) { link = anchor.href; break; }
      if (expansionCard.querySelector('.no-records-message')) { confirmedEmpty = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (link) return link;
    if (confirmedEmpty) continue; // this lesson has none - try the previous one
  }

  return null;
}

// Kept as a cheap secondary check in case Kodland ever starts including
// the recording link directly in the schedule_view API response.
function extractRecordingLinkFromLesson(lesson) {
  if (!lesson) return null;
  const candidates = [
    lesson.zoom_recording_url,
    lesson.recording_url,
    lesson.record_url,
    lesson.records_url,
    lesson.video_url,
    lesson.class_record_url,
    lesson.lesson_record_url,
    lesson.zoom_record_url
  ];
  const found = candidates.find(v => typeof v === 'string' && v.trim().length > 0);
  return found ? found.trim() : null;
}

// Resolves the recording link for the group's last past lesson: first
// tries reading it straight out of the "Horario" tab's DOM (if it's
// already rendered), then a couple of long-shot API field names, and
// finally asks the tutor to paste it - with exact directions to where it
// lives - so the button still works even when auto-detection fails.
async function getLastClassRecordingLink(groupId) {
  let link = await scrapeRecordingLinkFromScheduleDOM().catch(() => null);

  const lastPastLesson = groupId ? await fetchLastPastLessonForGroup(groupId) : null;

  if (!link) {
    link = extractRecordingLinkFromLesson(lastPastLesson);
  }

  if (!link) {
    const tabUrl = groupId ? `https://bo.kodland.org/groups/${groupId}?tab=2` : null;
    const instructions = 'No pude encontrar el link de la grabación automáticamente.' +
      (tabUrl
        ? `\n\n1. Abre esta pestaña: ${tabUrl}\n2. Busca la última clase completada y haz clic en "Grabaciones de la clase".\n3. Copia el link "Enlace - S3" y pégalo aquí:`
        : '\nPégalo aquí:');
    const pasted = prompt(instructions);
    link = pasted ? pasted.trim() : null;
  }

  return { link: link || null, lesson: lastPastLesson };
}

async function fetchLastLessonForGroup(groupId) {
  try {
    const apiUrl = `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/schedule_view/`;
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(apiUrl, { method: 'GET', credentials: 'include', headers });
    if (!response.ok) return null;

    const scheduleData = await response.json();
    return findLastLesson(scheduleData);
  } catch (error) {
    console.error(`[Schedule] Error fetching last lesson for group ${groupId}:`, error);
    return null;
  }
}

// Fetch the first lesson (M1L1) for a group - reuses the same schedule_view
// endpoint as fetchNearestLessonForGroup, but picks the earliest lesson
// instead of the next upcoming one.
async function fetchFirstLessonForGroup(groupId) {
  try {
    const apiUrl = `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/schedule_view/`;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers
    });

    if (!response.ok) {
      console.error(`[Schedule] HTTP error ${response.status} fetching schedule for group ${groupId}`);
      return null;
    }

    const scheduleData = await response.json();
    return findFirstLesson(scheduleData);
  } catch (error) {
    console.error(`[Schedule] Error fetching first lesson for group ${groupId}:`, error);
    return null;
  }
}



// Function to format time according to country timezone
function formatTimeForCountry(dateTimeString, countryCode) {
  if (!dateTimeString) return '';
  
  const date = new Date(dateTimeString);
  
  // Map country codes to timezones (simplified - using major cities)
  const timezoneMap = {
    'MX': 'America/Mexico_City',
    'US': 'America/New_York',
    'CR': 'America/Costa_Rica',
    'AR': 'America/Argentina/Buenos_Aires',
    'ES': 'Europe/Madrid',
    'CL': 'America/Santiago',
    'CO': 'America/Bogota',
    'PE': 'America/Lima',
    'PA': 'America/Panama',
    'PE': 'America/Lima',
    'EC': 'America/Guayaquil',
    'BO': 'America/La_Paz',
    'PY': 'America/Asuncion',
    'UY': 'America/Montevideo',
    'VE': 'America/Caracas',
    'GT': 'America/Guatemala',
    'HN': 'America/Tegucigalpa',
    'NI': 'America/Managua',
    'SV': 'America/El_Salvador',
    'DO': 'America/Santo_Domingo',
    'CU': 'America/Havana',
    'PR': 'America/Puerto_Rico',
    'BR': 'America/Sao_Paulo',
    'PT': 'Europe/Lisbon',
    'RU': 'Europe/Moscow',
    'FR': 'Europe/Paris',
    'TR': 'Europe/Istanbul',
    'ID': 'Asia/Jakarta',
    'IT': 'Europe/Rome',
    'PL': 'Europe/Warsaw'
  };
  
  const timezone = timezoneMap[countryCode] || 'UTC';
  
  try {
    // Format time in 12-hour format with AM/PM
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return formatter.format(date);
  } catch (e) {
    // Fallback to UTC if timezone not supported
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }
}

// Function to format date according to country
function formatDateForCountry(dateTimeString, countryCode, language = 'es') {
  if (!dateTimeString) return '';
  
  const date = new Date(dateTimeString);
  
  // Map country codes to locales
  const localeMap = {
    'MX': 'es-MX',
    'US': 'en-US',
    'CR': 'es-CR',
    'AR': 'es-AR',
    'ES': 'es-ES',
    'CL': 'es-CL',
    'CO': 'es-CO',
    'PE': 'es-PE',
    'PA': 'es-PA',
    'EC': 'es-EC',
    'BO': 'es-BO',
    'PY': 'es-PY',
    'UY': 'es-UY',
    'VE': 'es-VE',
    'GT': 'es-GT',
    'HN': 'es-HN',
    'NI': 'es-NI',
    'SV': 'es-SV',
    'DO': 'es-DO',
    'CU': 'es-CU',
    'PR': 'es-PR',
    'BR': 'pt-BR',
    'PT': 'pt-PT',
    'RU': 'ru-RU',
    'FR': 'fr-FR',
    'TR': 'tr-TR',
    'ID': 'id-ID',
    'IT': 'it-IT',
    'PL': 'pl-PL'
  };
  
  const locale = localeMap[countryCode] || (language === 'es' ? 'es-ES' : 'en-US');
  
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    return formatter.format(date);
  } catch (e) {
    // Fallback
    return date.toLocaleDateString();
  }
}

// Function to calculate time remaining until class
function calculateTimeRemaining(lessonTimeMs, nowTime) {
  const diffMs = lessonTimeMs - nowTime;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  return {
    minutes: diffMinutes,
    hours: diffHours,
    days: diffDays,
    totalMinutes: diffMinutes
  };
}

// Function to format time remaining text
function formatTimeRemaining(timeRemaining, language = 'es') {
  const { minutes, hours } = timeRemaining;
  
  const messages = {
    es: {
      minutes: (m) => m === 1 ? '1 minuto' : `${m} minutos`,
      hours: (h) => h === 1 ? '1 hora' : `${h} horas`,
      hoursMinutes: (h, m) => {
        if (h === 0) return m === 1 ? '1 minuto' : `${m} minutos`;
        if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
        return `${h} ${h === 1 ? 'hora' : 'horas'} y ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
      }
    },
    en: {
      minutes: (m) => m === 1 ? '1 minute' : `${m} minutes`,
      hours: (h) => h === 1 ? '1 hour' : `${h} hours`,
      hoursMinutes: (h, m) => {
        if (h === 0) return m === 1 ? '1 minute' : `${m} minutes`;
        if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
        return `${h} ${h === 1 ? 'hour' : 'hours'} and ${m} ${m === 1 ? 'minute' : 'minutes'}`;
      }
    },
    ru: {
      minutes: (m) => {
        if (m === 1) return '1 минуту';
        if (m < 5) return `${m} минуты`;
        return `${m} минут`;
      },
      hours: (h) => {
        if (h === 1) return '1 час';
        if (h < 5) return `${h} часа`;
        return `${h} часов`;
      },
      hoursMinutes: (h, m, msg) => {
        if (h === 0) return msg.minutes(m);
        if (m === 0) return msg.hours(h);
        return `${msg.hours(h)} и ${msg.minutes(m)}`;
      }
    },
    fr: {
      minutes: (m) => m === 1 ? '1 minute' : `${m} minutes`,
      hours: (h) => h === 1 ? '1 heure' : `${h} heures`,
      hoursMinutes: (h, m) => {
        if (h === 0) return m === 1 ? '1 minute' : `${m} minutes`;
        if (m === 0) return h === 1 ? '1 heure' : `${h} heures`;
        return `${h} ${h === 1 ? 'heure' : 'heures'} et ${m} ${m === 1 ? 'minute' : 'minutes'}`;
      }
    },
    tr: {
      minutes: (m) => `${m} dakika`,
      hours: (h) => `${h} saat`,
      hoursMinutes: (h, m) => {
        if (h === 0) return `${m} dakika`;
        if (m === 0) return `${h} saat`;
        return `${h} saat ${m} dakika`;
      }
    },
    id: {
      minutes: (m) => `${m} menit`,
      hours: (h) => `${h} jam`,
      hoursMinutes: (h, m) => {
        if (h === 0) return `${m} menit`;
        if (m === 0) return `${h} jam`;
        return `${h} jam ${m} menit`;
      }
    },
    it: {
      minutes: (m) => m === 1 ? '1 minuto' : `${m} minuti`,
      hours: (h) => h === 1 ? '1 ora' : `${h} ore`,
      hoursMinutes: (h, m) => {
        if (h === 0) return m === 1 ? '1 minuto' : `${m} minuti`;
        if (m === 0) return h === 1 ? '1 ora' : `${h} ore`;
        return `${h} ${h === 1 ? 'ora' : 'ore'} e ${m} ${m === 1 ? 'minuto' : 'minuti'}`;
      }
    },
    pl: {
      minutes: (m) => {
        if (m === 1) return '1 minutę';
        if (m < 5) return `${m} minuty`;
        return `${m} minut`;
      },
      hours: (h) => {
        if (h === 1) return '1 godzinę';
        if (h < 5) return `${h} godziny`;
        return `${h} godzin`;
      },
      hoursMinutes: (h, m, msg) => {
        if (h === 0) return msg.minutes(m);
        if (m === 0) return msg.hours(h);
        return `${msg.hours(h)} i ${msg.minutes(m)}`;
      }
    },
    pt: {
      minutes: (m) => m === 1 ? '1 minuto' : `${m} minutos`,
      hours: (h) => h === 1 ? '1 hora' : `${h} horas`,
      hoursMinutes: (h, m) => {
        if (h === 0) return m === 1 ? '1 minuto' : `${m} minutos`;
        if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
        return `${h} ${h === 1 ? 'hora' : 'horas'} e ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
      }
    }
  };
  
  const msg = messages[language] || messages.es;
  
  if (hours === 0) {
    return msg.minutes(minutes);
  } else if (minutes < 30) {
    return msg.hours(hours);
  } else {
    const remainingMinutes = minutes % 60;
    return msg.hoursMinutes(hours, remainingMinutes, msg);
  }
}

// Function to generate class reminder message
function generateClassReminderMessage(parentName, lesson, countryCode, language = 'es') {
  if (!lesson) {
    return null;
  }
  
  const lessonTime = new Date(lesson.timetable_time);
  const now = new Date();
  const nowTime = now.getTime();
  const lessonTimeMs = lessonTime.getTime();
  
  // Check if class is today, tomorrow, or later
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lessonDate = new Date(lessonTime.getFullYear(), lessonTime.getMonth(), lessonTime.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const isToday = lessonDate.getTime() === today.getTime();
  const isTomorrow = lessonDate.getTime() === tomorrow.getTime();
  
  const lessonNumber = lesson.lesson_number || 0;
  const zoomLink = lesson.zoom_schedule_join_url || '';
  
  // Class has started if lesson time is now or in the past (within last 15 minutes)
  const fifteenMinutesAgo = nowTime - (15 * 60 * 1000);
  const hasStarted = lessonTimeMs <= nowTime && lessonTimeMs >= fifteenMinutesAgo;
  
  if (hasStarted) {
    // Class just started
    const messages = {
      es: `Hola ${parentName}, te recordamos que nuestra clase número ${lessonNumber} ya empezó.`,
      en: `Hello ${parentName}, we remind you that our class number ${lessonNumber} has already started.`,
      ru: `Привет ${parentName}, напоминаем, что наш урок номер ${lessonNumber} уже начался.`,
      fr: `Bonjour ${parentName}, nous vous rappelons que notre cours numéro ${lessonNumber} a déjà commencé.`,
      tr: `Merhaba ${parentName}, ${lessonNumber} numaralı dersimizin başladığını hatırlatıyoruz.`,
      id: `Halo ${parentName}, kami mengingatkan bahwa kelas nomor ${lessonNumber} sudah dimulai.`,
      it: `Ciao ${parentName}, ti ricordiamo che la nostra lezione numero ${lessonNumber} è già iniziata.`,
      pl: `Cześć ${parentName}, przypominamy, że nasza lekcja numer ${lessonNumber} już się rozpoczęła.`,
      pt: `Olá ${parentName}, lembramos que nossa aula número ${lessonNumber} já começou.`
    };
    
    let message = messages[language] || messages.es;
    if (zoomLink) {
      message += `\n\n${language === 'es' ? 'Únete por el siguiente enlace:' : 'Join via the following link:'}\n${zoomLink}`;
    }
    return message;
  }
  
  if (isToday) {
    // Class is today - show time remaining
    const timeRemaining = calculateTimeRemaining(lessonTimeMs, nowTime);
    const timeText = formatTimeRemaining(timeRemaining, language);
    
    const messages = {
      es: `Hola ${parentName}, nos vemos en ${timeText}.`,
      en: `Hello ${parentName}, see you in ${timeText}.`,
      ru: `Привет ${parentName}, увидимся через ${timeText}.`,
      fr: `Bonjour ${parentName}, à bientôt dans ${timeText}.`,
      tr: `Merhaba ${parentName}, ${timeText} içinde görüşürüz.`,
      id: `Halo ${parentName}, sampai jumpa dalam ${timeText}.`,
      it: `Ciao ${parentName}, ci vediamo tra ${timeText}.`,
      pl: `Cześć ${parentName}, do zobaczenia za ${timeText}.`,
      pt: `Olá ${parentName}, nos vemos em ${timeText}.`
    };
    
    let message = messages[language] || messages.es;
    if (zoomLink) {
      message += `\n\n${language === 'es' ? 'Por el siguiente enlace:' : 'Via the following link:'}\n${zoomLink}`;
    }
    return message;
  }
  
  // Class is tomorrow or later - general reminder
  const formattedDate = formatDateForCountry(lesson.timetable_time, countryCode, language);
  
  const messages = {
    es: {
      tomorrow: `Hola ${parentName}, te recordamos que mañana tenemos nuestra clase número ${lessonNumber + 1}. No olvides revisar tus actividades y si tienes dudas me puedes escribir.`,
      later: `Hola ${parentName}, te recordamos que el ${formattedDate} tenemos nuestra clase número ${lessonNumber + 1}. No olvides revisar tus actividades y si tienes dudas me puedes escribir.`
    },
    en: {
      tomorrow: `Hello ${parentName}, we remind you that tomorrow we have our class number ${lessonNumber + 1}. Don't forget to review your activities and if you have questions you can write to me.`,
      later: `Hello ${parentName}, we remind you that on ${formattedDate} we have our class number ${lessonNumber + 1}. Don't forget to review your activities and if you have questions you can write to me.`
    },
    ru: {
      tomorrow: `Привет ${parentName}, напоминаем, что завтра у нас урок номер ${lessonNumber + 1}. Не забудьте проверить свои задания, и если у вас есть вопросы, вы можете написать мне.`,
      later: `Привет ${parentName}, напоминаем, что ${formattedDate} у нас урок номер ${lessonNumber + 1}. Не забудьте проверить свои задания, и если у вас есть вопросы, вы можете написать мне.`
    },
    fr: {
      tomorrow: `Bonjour ${parentName}, nous vous rappelons que demain nous avons notre cours numéro ${lessonNumber + 1}. N'oubliez pas de réviser vos activités et si vous avez des questions, vous pouvez m'écrire.`,
      later: `Bonjour ${parentName}, nous vous rappelons que le ${formattedDate} nous avons notre cours numéro ${lessonNumber + 1}. N'oubliez pas de réviser vos activités et si vous avez des questions, vous pouvez m'écrire.`
    },
    tr: {
      tomorrow: `Merhaba ${parentName}, yarın ${lessonNumber + 1} numaralı dersimiz olduğunu hatırlatıyoruz. Aktivitelerinizi gözden geçirmeyi unutmayın ve sorularınız varsa bana yazabilirsiniz.`,
      later: `Merhaba ${parentName}, ${formattedDate} tarihinde ${lessonNumber + 1} numaralı dersimiz olduğunu hatırlatıyoruz. Aktivitelerinizi gözden geçirmeyi unutmayın ve sorularınız varsa bana yazabilirsiniz.`
    },
    id: {
      tomorrow: `Halo ${parentName}, kami mengingatkan bahwa besok kami memiliki kelas nomor ${lessonNumber + 1}. Jangan lupa untuk meninjau aktivitas Anda dan jika Anda memiliki pertanyaan, Anda dapat menulis kepada saya.`,
      later: `Halo ${parentName}, kami mengingatkan bahwa pada ${formattedDate} kami memiliki kelas nomor ${lessonNumber + 1}. Jangan lupa untuk meninjau aktivitas Anda dan jika Anda memiliki pertanyaan, Anda dapat menulis kepada saya.`
    },
    it: {
      tomorrow: `Ciao ${parentName}, ti ricordiamo che domani abbiamo la nostra lezione numero ${lessonNumber + 1}. Non dimenticare di rivedere le tue attività e se hai domande puoi scrivermi.`,
      later: `Ciao ${parentName}, ti ricordiamo che il ${formattedDate} abbiamo la nostra lezione numero ${lessonNumber + 1}. Non dimenticare di rivedere le tue attività e se hai domande puoi scrivermi.`
    },
    pl: {
      tomorrow: `Cześć ${parentName}, przypominamy, że jutro mamy naszą lekcję numer ${lessonNumber + 1}. Nie zapomnij przejrzeć swoich aktywności i jeśli masz pytania, możesz do mnie napisać.`,
      later: `Cześć ${parentName}, przypominamy, że ${formattedDate} mamy naszą lekcję numer ${lessonNumber + 1}. Nie zapomnij przejrzeć swoich aktywności i jeśli masz pytania, możesz do mnie napisać.`
    },
    pt: {
      tomorrow: `Olá ${parentName}, lembramos que amanhã temos nossa aula número ${lessonNumber + 1}. Não se esqueça de revisar suas atividades e se tiver dúvidas, pode me escrever.`,
      later: `Olá ${parentName}, lembramos que em ${formattedDate} temos nossa aula número ${lessonNumber + 1}. Não se esqueça de revisar suas atividades e se tiver dúvidas, pode me escrever.`
    }
  };
  
  const msg = messages[language] || messages.es;
  return isTomorrow ? msg.tomorrow : msg.later;
}

// Function to fetch the personalized "wonder login" direct-access link for a student
async function fetchWonderLoginLink(studentId) {
  const apiUrl = `https://backoffice.kodland.org/api/v1/wonderlogin/generate/?student_id=${studentId}`;

  try {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers
    });

    if (!response.ok) {
      console.error(`[WonderLogin] HTTP error ${response.status} for student ${studentId}`);
      return null;
    }

    const data = await response.json();
    return data.url || null;
  } catch (error) {
    console.error(`[WonderLogin] Error fetching link for student ${studentId}:`, error);
    return null;
  }
}

// Function to fetch the nearest/current lesson for a group (used for the
// welcome message's class day/time, and reusable wherever schedule info is needed)
async function fetchNearestLessonForGroup(groupId) {
  try {
    const apiUrl = `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/schedule_view/`;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: headers
    });

    if (!response.ok) {
      console.error(`[Schedule] HTTP error ${response.status} fetching schedule for group ${groupId}`);
      return null;
    }

    const scheduleData = await response.json();
    return findNearestLesson(scheduleData);
  } catch (error) {
    console.error(`[Schedule] Error fetching nearest lesson for group ${groupId}:`, error);
    return null;
  }
}

// Format a lesson's date/time in Spanish, Colombia timezone, e.g.
// { dayName: 'viernes', fullDate: '19 de junio de 2026', time: '16:00' }
function formatLessonDateForMessage(isoDateStr) {
  try {
    const date = new Date(isoDateStr);

    const dayName = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'America/Bogota' }).format(date);
    const dayNum = new Intl.DateTimeFormat('es-CO', { day: 'numeric', timeZone: 'America/Bogota' }).format(date);
    const month = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'America/Bogota' }).format(date);
    const year = new Intl.DateTimeFormat('es-CO', { year: 'numeric', timeZone: 'America/Bogota' }).format(date);
    const time = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' }).format(date);

    return {
      dayName,
      fullDate: `${dayNum} de ${month} de ${year}`,
      time
    };
  } catch (error) {
    console.warn('[formatLessonDateForMessage] Error formatting date:', error);
    return null;
  }
}

// Build the full welcome message using the tutor's exact script.
// NOTE: edit `tutorName` below if a different tutor uses this extension.
function createFullWelcomeMessage({ studentName, courseName, waGroupLink, wonderLoginUrl, username, password, lessonDateInfo }) {
  const settings = getExtensionSettings();
  const tutorName = settings.tutorName || 'Gehiner Sierra';

  const scheduleLine = lessonDateInfo
    ? `que comenzará este ${lessonDateInfo.dayName} ${lessonDateInfo.fullDate} a las ${lessonDateInfo.time} horas (hora Colombia)`
    : 'que comenzará muy pronto';

  const waLine = waGroupLink || '[Aún no se detectó el link del grupo de WhatsApp - haz clic en el botón de chat de la página del curso]';

  const template = settings.welcomeTemplate || DEFAULT_WELCOME_TEMPLATE;

  return renderTemplate(template, {
    studentName,
    tutorName,
    courseName,
    scheduleLine,
    waGroupLink: waLine,
    wonderLoginUrl,
    username,
    password
  });
}

// Build a map of lessonId -> "M{module}L{lesson}" label (matching the visual
// numbering used on the group page), by walking the modules/lessons
// structure returned by fetchHomeworkModulesProgress.
function buildLessonLabelMap(modulesData) {
  const labelMap = {};

  let modulesArray = [];
  if (Array.isArray(modulesData)) {
    modulesArray = modulesData;
  } else if (modulesData && typeof modulesData === 'object') {
    modulesArray = modulesData.modules || modulesData.data || [];
  }

  modulesArray.forEach((module, moduleIndex) => {
    const lessons = Array.isArray(module.lessons) ? module.lessons : [];
    lessons.forEach((lesson, lessonIndex) => {
      const lessonId = lesson.id || lesson.lesson_id;
      if (lessonId !== undefined && lessonId !== null) {
        labelMap[String(lessonId)] = `M${moduleIndex + 1}L${lessonIndex + 1}`;
      }
    });
  });

  return labelMap;
}

// ---------------------------------------------------------------------
// Task alerts: pending grading (tutor) / not submitted (student)
// ---------------------------------------------------------------------
const studentTaskAlertsCache = {};

// Fetch every lesson's class + homework tasks for a student and compute:
// - pendingGradingCount: tasks the student already submitted but the tutor
//   hasn't graded/checked yet (TASK_SUBMITTED / TASK_SUBMITTED_LATE / TASK_NOT_GRADED)
// - notSubmittedTasks: names of tasks the student hasn't submitted at all (TASK_NOT_SUBMITTED)
// Reuses the same fetching pipeline as the tasks modal, just without building any UI.
async function fetchStudentTaskAlerts(studentId) {
  const groupId = extractGroupId();
  if (!groupId) return null;

  const progressData = await fetchHomeworkModulesProgress(studentId, groupId);
  if (!progressData) return null;

  const lessonsInfo = getCompletedLessonsCount();
  const maxLessons = lessonsInfo ? lessonsInfo.completed : null;

  let lessonIds = extractLessonIds(progressData, maxLessons);
  if (maxLessons !== null && maxLessons > 0 && lessonIds.length > maxLessons) {
    lessonIds = lessonIds.slice(0, maxLessons);
  }

  const lessonLabelMap = buildLessonLabelMap(progressData);

  let pendingGradingCount = 0;
  const pendingGradingTasks = [];
  const notSubmittedTasks = [];

  const extractTasksArray = (taskGroup) => {
    if (!taskGroup) return [];
    if (Array.isArray(taskGroup)) return taskGroup;
    if (typeof taskGroup === 'object') return taskGroup.tasks || taskGroup.data || [taskGroup];
    return [];
  };

  const batchSize = 3;
  for (let i = 0; i < lessonIds.length; i += batchSize) {
    const batch = lessonIds.slice(i, i + batchSize);

    const batchResults = await Promise.all(batch.map(async (lessonId, batchIndex) => {
      const [classTasks, homeworkTasks] = await Promise.all([
        fetchClassTasksProgress(studentId, lessonId),
        fetchHomeworkTasksProgress(studentId, lessonId)
      ]);
      const label = lessonLabelMap[String(lessonId)] || `Lección ${i + batchIndex + 1}`;
      return { classTasks, homeworkTasks, label };
    }));

    batchResults.forEach(({ classTasks, homeworkTasks, label }) => {
      [...extractTasksArray(classTasks), ...extractTasksArray(homeworkTasks)].forEach(task => {
        const statusKey = task.task_status_key || task.status_key || '';
        const taskName = task.task_title || task.title || task.name || task.task_name || 'Tarea sin nombre';
        const taskId = task.task_id || task.id || null;

        // "Teoría" tasks are auto-graded by the platform (quizzes/reading
        // checks), so they never need a tutor to review them manually.
        // Heuristic 1: name contains "teoría"/"teoria".
        // Heuristic 2: tasks with no max grade defined are typically
        // auto-scored (the per-student modal only shows a grade badge
        // when task_max_grade > 0), so they're not tutor-gradable either.
        const isTheoryTask = /teor/i.test(taskName) || !(task.task_max_grade > 0);

        if (statusKey === 'TASK_SUBMITTED' || statusKey === 'TASK_SUBMITTED_LATE' || statusKey === 'TASK_NOT_GRADED') {
          if (!isTheoryTask) {
            pendingGradingCount++;
            pendingGradingTasks.push({ name: taskName, label, taskId });
          }
        } else if (statusKey === 'TASK_NOT_SUBMITTED') {
          if (!isTheoryTask) {
            notSubmittedTasks.push({ name: taskName, label });
          }
        }
      });
    });

    if (i + batchSize < lessonIds.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  const result = { pendingGradingCount, pendingGradingTasks, notSubmittedTasks };
  studentTaskAlertsCache[studentId] = result;
  return result;
}

// Fetch the grading report for EVERY student currently loaded in the group
// (sequentially, with a short pause between students to avoid hammering the
// API). Returns a list sorted by pendingGradingCount, descending.
async function fetchGroupGradingReport(onProgress = null) {
  const students = findStudentElements();
  const report = [];

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const cleanName = extractStudentName(student.container);
    if (onProgress) onProgress(i + 1, students.length, cleanName);

    try {
      const alerts = await fetchStudentTaskAlerts(student.id);
      if (alerts) {
        report.push({
          name: cleanName,
          studentId: student.id,
          pendingGradingCount: alerts.pendingGradingCount,
          pendingGradingTasks: alerts.pendingGradingTasks
        });
      }
    } catch (error) {
      console.error(`[Group Grading Report] Error checking ${cleanName}:`, error);
    }

    if (i < students.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  report.sort((a, b) => b.pendingGradingCount - a.pendingGradingCount);
  return report;
}

// Show the group grading report in a modal (reusing the existing modal styles)
function showGroupGradingReportModal(report) {
  const existing = document.getElementById('kodland-grading-report-modal');
  if (existing) existing.remove();

  const totalPending = report.reduce((sum, r) => sum + r.pendingGradingCount, 0);
  const withPending = report.filter(r => r.pendingGradingCount > 0);

  // Same URL pattern used by the per-student tasks modal
  const langUrlMap = { es: 'es', en: 'en', ru: 'ru', fr: 'fr', tr: 'tr', id: 'id', it: 'it', pl: 'pl', pt: 'pt' };
  const langPath = langUrlMap[detectPageLanguage()] || 'es';

  const rowsHtml = withPending.length === 0
    ? `<p class="kodland-no-tasks">🎉 Nadie tiene tareas pendientes de calificar.</p>`
    : withPending.map(r => {
        const tasksList = r.pendingGradingTasks
          .map(t => {
            const link = t.taskId
              ? `<a class="kodland-task-link" href="https://learn.kodland.org/${langPath}/task/${t.taskId}/check/${r.studentId}" target="_blank" rel="noopener noreferrer">↗ Calificar</a>`
              : '';
            return `<div class="kodland-task-item"><div class="kodland-task-info"><span class="kodland-task-name">${t.label}: ${t.name}</span>${link}</div></div>`;
          })
          .join('');
        return `
          <div class="kodland-lesson-card">
            <div class="kodland-lesson-header">${r.name} — ${r.pendingGradingCount} tarea(s) por calificar</div>
            <div class="kodland-tasks-list">${tasksList}</div>
          </div>
        `;
      }).join('');

  const modal = document.createElement('div');
  modal.id = 'kodland-grading-report-modal';
  modal.className = 'kodland-modal';
  modal.innerHTML = `
    <div class="kodland-modal-content">
      <div class="kodland-modal-header">
        <h2>📊 Reporte de calificación del grupo (${totalPending} pendientes en total)</h2>
        <button id="kodland-calificar-todo-btn" class="kodland-toolbar-btn">✅ Calificar</button>
        <button class="kodland-modal-close">&times;</button>
      </div>
      <div class="kodland-modal-body">
        ${rowsHtml}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('.kodland-modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  // kodland-calificar-todo-btn
  modal.querySelector('#kodland-calificar-todo-btn')
  .addEventListener('click', async () => {

      try {

          const respuesta =
              await window.KodlandCalificador.ejecutar("calificar");

          console.log(respuesta);

      } catch (e) {

          console.error(e);

      }

  });
}

// All floating action buttons (broadcast + settings + export + grading
// report + WA link) now live together in this single toolbar
// fixed to the top of the page, instead of being scattered as separate
// stacked pill buttons. Every inject*Button() function below fetches (or
// creates, if it's the first one to run) this shared wrapper and appends
// its button to it.
function getOrCreateToolbar() {
  let wrapper = document.getElementById('kodland-broadcast-buttons');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'kodland-broadcast-buttons';
    wrapper.className = 'kodland-broadcast-buttons';
    document.body.appendChild(wrapper);

    // The toolbar is `position: fixed`, so it floats ON TOP of the page
    // instead of pushing it down. With only a handful of buttons that was
    // barely noticeable, but now that it can hold up to 9 buttons (and
    // wrap into 2-3 rows on smaller screens) it was tall enough to cover
    // the first row of students on the group page. Keep body padding in
    // sync with the toolbar's real rendered height so nothing ends up
    // hidden underneath it.
    const adjustBodyPadding = () => {
      const height = wrapper.offsetHeight;
      document.body.style.paddingTop = height > 0 ? `${height + 16}px` : '';
    };
    adjustBodyPadding();
    // Re-measure whenever the toolbar's own size changes (buttons
    // shown/hidden via settings, or it wraps to more/fewer rows on resize).
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(adjustBodyPadding).observe(wrapper);
    } else {
      window.addEventListener('resize', adjustBodyPadding);
    }
  }
  return wrapper;
}

// Inject the floating "Group grading report" button
function injectGroupGradingReportButton() {
  if (!isGroupPage()) return;
  if (!getExtensionSettings().showGroupGradingReport) return;
  if (document.getElementById('kodland-grading-report-button')) return;

  const button = document.createElement('button');
  button.id = 'kodland-grading-report-button';
  button.className = 'kodland-toolbar-btn kodland-grading-report-btn';
  button.innerHTML = `📊 Reporte calificación`;
  button.setAttribute('title', 'Revisar cuántas tareas le faltan calificar a cada estudiante del grupo');

  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    button.disabled = true;
    const originalHtml = button.innerHTML;

    try {
      const report = await fetchGroupGradingReport((current, total, name) => {
        button.innerHTML = `⏳ ${current}/${total}...`;
      });
      showGroupGradingReportModal(report);
    } catch (error) {
      console.error('[Group Grading Report] Error:', error);
      alert('Ocurrió un error armando el reporte. Revisa la consola.');
    } finally {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  });

  getOrCreateToolbar().appendChild(button);
  console.log('[Group Students Info] ✅ Botón "Reporte calificación" inyectado');
}

// Function to display student info with buttons
function displayStudentInfo(container, studentData, studentId) {
  // Remove existing info element if any
  const existingInfo = container.querySelector('.kodland-student-buttons');
  if (existingInfo) {
    existingInfo.remove();
  }
  
  if (!studentData) {
    const loadingElement = document.createElement('div');
    loadingElement.className = 'kodland-student-buttons';
    loadingElement.style.cssText = 'margin-top: 8px; padding: 8px; color: #999; font-size: 11px;';
    loadingElement.innerHTML = '⏳ Loading...';
    container.appendChild(loadingElement);
    return;
  }
  
  // Extract parent information
  const parentName = studentData.parent_name || 
                     studentData.parent?.name || 
                     studentData.parent_name_full ||
                     'Parent';
  
  const parentPhone = studentData.parent_phone || 
                      studentData.parent?.phone || 
                      studentData.parent_phone_number ||
                      studentData.parent?.phone_number ||
                      null;
  
  // Extract credentials from studentData if available (to avoid another API call)
  const studentLogin = studentData.student_login || 
                       studentData.student_user || 
                       studentData.student_username || '';
  
  const studentPassword = studentData.student_password || 
                          studentData.student_pass || '';
  
  // Cache credentials if found
  if (studentLogin && studentPassword) {
    const credentials = {
      username: studentLogin,
      password: studentPassword,
      formatted: `Usuario: ${studentLogin}\nContraseña: ${studentPassword}`
    };
    studentCredentialsCache[studentId] = credentials;
    console.log(`[Group Students Info] ✅ Credentials cached from studentData for student ${studentId}`);
  }
  
  console.log(`[Group Students Info] Parent info for student ${studentId}:`, {
    parentName,
    parentPhone,
    hasCredentials: !!(studentLogin && studentPassword)
  });
  
  if (!parentPhone) {
    return; // Don't show buttons if no phone
  }
  
  // Get language for tooltips
  const language = detectPageLanguage();
  const tooltips = getButtonTooltips(language);
  
  // Find the student name h3 element using XPath (inside the <a> tag)
  const xpath = './/a[contains(@href, "/students/")]/h3';
  let studentH3 = null;
  
  try {
    const result = document.evaluate(
      xpath,
      container,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    studentH3 = result.singleNodeValue;
  } catch (error) {
    console.warn('[Group Students Info] Error finding h3 with XPath, trying alternative:', error);
    // Fallback: find h3 inside student link
    const fallbackLink = container.querySelector('a[href^="/students/"]');
    if (fallbackLink) {
      studentH3 = fallbackLink.querySelector('h3');
    }
  }
  
  if (!studentH3) {
    console.warn('[Group Students Info] Could not find student h3 element');
    return;
  }
  
  // Get the parent <a> element
  const studentLink = studentH3.closest('a[href^="/students/"]');
  if (!studentLink) {
    console.warn('[Group Students Info] Could not find student link element');
    return;
  }
  
  // Check if buttons already exist (search outside the link as well)
  const existingButtons = document.querySelector(`.kodland-student-buttons[data-student-id="${studentId}"]`);
  if (existingButtons) {
    existingButtons.remove();
  }
  
  // Check if country initials already exist inside h3
  const existingInitials = studentH3.querySelector('.kodland-country-initials');
  if (existingInitials) {
    existingInitials.remove();
  }
  
  // Get country initials from phone number
  console.log(`[Group Students Info] Getting country initials for phone: ${parentPhone}`);
  const countryCode = getCountryCodeFromPhone(parentPhone);
  console.log(`[Group Students Info] Extracted country code: ${countryCode}`);
  const countryInitials = getCountryInitialsFromPhone(parentPhone);
  console.log(`[Group Students Info] Country initials result: "${countryInitials}"`);
  
  if (countryInitials && countryInitials.trim() && countryInitials.length > 0) {
    // Get current text content of h3
    const currentText = studentH3.textContent || studentH3.innerText || '';
    console.log(`[Group Students Info] Current h3 text: "${currentText}"`);
    
    // Check if initials are already in the text
    if (currentText.includes(`[${countryInitials}]`)) {
      console.log(`[Group Students Info] Initials already in text, skipping`);
    } else {
      // Create initials element
      const initialsElement = document.createElement('span');
      initialsElement.className = 'kodland-country-initials';
      initialsElement.textContent = `[${countryInitials}]`;
      initialsElement.style.cssText = `
        margin-right: 6px;
        font-size: 12px;
        font-weight: 600;
        vertical-align: middle;
        display: inline-block;
        color: #666;
        letter-spacing: 0.5px;
      `;
      initialsElement.setAttribute('title', `Country code: ${countryCode}`);
      
      // Insert initials at the beginning of h3 (before the student name)
      studentH3.insertBefore(initialsElement, studentH3.firstChild);
      
      console.log(`[Group Students Info] ✅ Added country initials "[${countryInitials}]" for phone ${parentPhone} (code: ${countryCode})`);
      console.log(`[Group Students Info] h3 textContent after initials:`, studentH3.textContent);
    }
  } else {
    console.warn(`[Group Students Info] ⚠️ No country initials found for phone ${parentPhone} (code: ${countryCode})`);
  }
  
  // Create buttons container (outside the <a> tag)
  const buttonsContainer = document.createElement('span');
  buttonsContainer.className = 'kodland-student-buttons';
  
  // No need for container click handler since buttons are outside the link
  // Each button has its own handler with preventDefault and stopPropagation
  
  const formattedPhone = formatPhoneForWhatsApp(parentPhone);
  
  // Button 1: Open WA (icon only)
  const openWAButton = document.createElement('button');
  openWAButton.className = 'kodland-wa-btn kodland-open-btn';
  openWAButton.setAttribute('title', tooltips.openWA);
  openWAButton.setAttribute('aria-label', tooltips.openWA);
  openWAButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="currentColor"></path>
    </svg>
  `;
  openWAButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    console.log('[Group Students Info] Open WA button clicked!', { formattedPhone, studentId });
    
    if (!formattedPhone) {
      console.error('[Group Students Info] No formatted phone available');
      alert('No phone number available');
      return;
    }
    
    // Remove + sign for URL
    const phoneForUrl = formattedPhone.replace(/^\+/, '');
    
    // Use api.whatsapp.com for direct WhatsApp link (opens chat without message)
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}`;
    console.log(`[Group Students Info] Opening WhatsApp for parent phone: ${formattedPhone}`);
    window.open(whatsappUrl, '_blank');
  });
  
  // Button 2: Welcome Message (icon only)
  const sendCredentialButton = document.createElement('button');
  sendCredentialButton.className = 'kodland-wa-btn kodland-send-btn';
  sendCredentialButton.setAttribute('title', tooltips.welcomeMessage);
  sendCredentialButton.setAttribute('aria-label', tooltips.welcomeMessage);
  sendCredentialButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
    </svg>
  `;
  sendCredentialButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    console.log('[Group Students Info] Welcome Message button clicked!', { studentId });
    
    sendCredentialButton.disabled = true;
    sendCredentialButton.style.opacity = '0.5';
    sendCredentialButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.416" stroke-dashoffset="31.416">
          <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416;0 31.416" repeatCount="indefinite"/>
          <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416;-31.416" repeatCount="indefinite"/>
        </circle>
      </svg>
    `;
    
    const credentials = await getStudentCredentials(studentId);
    if (credentials) {
      // Get student name from container (without the "[XX]" country badge)
      const studentName = extractStudentName(container);
      
      // Get course name
      const courseName = findCourseName();
      console.log('[Group Students Info] Course name:', courseName);
      
      // Get the personalized direct-access link (wonder login)
      const wonderLoginUrl = await fetchWonderLoginLink(studentId);
      if (!wonderLoginUrl) {
        console.warn(`[Group Students Info] ⚠️ No se pudo obtener el link de acceso personalizado para ${studentId}`);
      }
      
      // Get the cached WhatsApp group link for this course
      const waGroupLink = getGroupWhatsAppLink();
      if (!waGroupLink) {
        console.warn('[Group Students Info] ⚠️ No hay link de WhatsApp del grupo guardado todavía');
      }
      
      // Get the FIRST lesson (M1L1) to fill in the course's start day/time
      // (not just whichever lesson happens to be coming up next)
      const groupId = extractGroupId();
      const firstLesson = groupId ? await fetchFirstLessonForGroup(groupId) : null;
      const lessonDateInfo = firstLesson ? formatLessonDateForMessage(firstLesson.timetable_time) : null;
      
      // Build the full welcome message
      const welcomeMessage = createFullWelcomeMessage({
        studentName,
        courseName,
        waGroupLink,
        wonderLoginUrl: wonderLoginUrl || '[No se pudo generar el link de acceso, revisa el perfil del estudiante]',
        username: credentials.username || '',
        password: credentials.password || '',
        lessonDateInfo
      });
      console.log('[Group Students Info] Welcome message (plain text):', welcomeMessage);
      
      // Encode message for WhatsApp URL
      const encodedMessage = encodeMessageForWhatsApp(welcomeMessage);
      
      // Remove + sign for URL
      const phoneForUrl = formattedPhone.replace(/^\+/, '');
      
      // Use api.whatsapp.com for WhatsApp link with message
      const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}&text=${encodedMessage}`;
      
      console.log(`[Group Students Info] Sending welcome message to parent phone: ${formattedPhone}`);
      window.open(whatsappUrl, '_blank');
      
      sendCredentialButton.disabled = false;
      sendCredentialButton.style.opacity = '1';
      sendCredentialButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
        </svg>
      `;
    } else {
      // Fallback: open student page in new tab to copy credentials manually
      window.open(`https://bo.kodland.org/students/${studentId}`, '_blank');
      sendCredentialButton.disabled = false;
      sendCredentialButton.style.opacity = '1';
      sendCredentialButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
        </svg>
      `;
    }
  });
  
  buttonsContainer.appendChild(openWAButton);
  buttonsContainer.appendChild(sendCredentialButton);
  
  // Button 3: Modules Progress (icon only)
  const modulesProgressButton = document.createElement('button');
  modulesProgressButton.className = 'kodland-wa-btn kodland-progress-btn';
  modulesProgressButton.setAttribute('title', tooltips.modulesProgress);
  modulesProgressButton.setAttribute('aria-label', tooltips.modulesProgress);
  modulesProgressButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" fill="currentColor"/>
    </svg>
  `;
  modulesProgressButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    console.log('[Group Students Info] Modules Progress button clicked!', { studentId });
    
    modulesProgressButton.disabled = true;
    modulesProgressButton.style.opacity = '0.5';
    modulesProgressButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.416" stroke-dashoffset="31.416">
          <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416;0 31.416" repeatCount="indefinite"/>
          <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416;-31.416" repeatCount="indefinite"/>
        </circle>
      </svg>
    `;
    
    const loadAndShow = async () => {
      // Get group ID from URL
      const groupId = extractGroupId();
      if (!groupId) {
        console.error('[Group Students Info] Could not extract group ID from URL');
        alert('Could not find group ID. Please make sure you are on a group page.');
        return;
      }
      
      console.log(`[Group Students Info] Fetching modules progress for student ${studentId} in group ${groupId}`);
      
      const progressData = await fetchHomeworkModulesProgress(studentId, groupId);
      
      if (progressData) {
        console.log(`[Group Students Info] ✅ Modules progress data loaded. Extracting lesson IDs...`);
        
        // Get completed lessons count from the page
        const lessonsInfo = getCompletedLessonsCount();
        const maxLessons = lessonsInfo ? lessonsInfo.completed : null;
        
        if (maxLessons !== null && maxLessons > 0) {
          console.log(`[Group Students Info] ✅ Will limit to ${maxLessons} completed lessons only`);
        } else {
          console.warn(`[Group Students Info] ⚠️ Could not determine completed lessons count (${maxLessons}), will process all found lessons`);
        }
        
        // Extract lesson IDs from the modules data, limiting to completed lessons
        let lessonIds = extractLessonIds(progressData, maxLessons);
        
        // CRITICAL: Force limit to completed lessons BEFORE processing
        if (maxLessons !== null && maxLessons > 0) {
          if (lessonIds.length > maxLessons) {
            lessonIds = lessonIds.slice(0, maxLessons);
          }
          lessonIds = lessonIds.slice(0, maxLessons);
          console.log(`[Group Students Info] 🔒 STRICT LIMIT APPLIED: Final count is ${lessonIds.length} lessons (max: ${maxLessons})`);
        }
        
        if (lessonIds.length > 0) {
          console.log(`[Group Students Info] ✅ Ready to process ${lessonIds.length} lessons. Fetching tasks progress asynchronously...`);
          
          // Store all tasks data organized by lesson
          const allTasksData = [];
          
          // Fetch tasks progress for each lesson
          const limitedLessonIds = maxLessons !== null && maxLessons > 0 
            ? lessonIds.slice(0, maxLessons) 
            : lessonIds;
          
          // Process lessons in batches of 3 (6 fetches total: 3 class + 3 homework)
          const batchSize = 3;
          for (let i = 0; i < limitedLessonIds.length; i += batchSize) {
            const batch = limitedLessonIds.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(limitedLessonIds.length / batchSize);
            
            console.log(`\n[Group Students Info] 📦 Processing batch ${batchNumber}/${totalBatches} (lessons ${i + 1}-${Math.min(i + batchSize, limitedLessonIds.length)})...`);
            console.log(`[Group Students Info] Batch lesson IDs (in order):`, batch);
            
            // Create all fetch promises for this batch (6 fetches: 3 class + 3 homework)
            // Use map with index to ensure order is preserved
            const fetchPromises = batch.map((lessonId, batchIndex) => {
              // Store original index in batch to maintain order
              const originalIndex = i + batchIndex;
              return Promise.all([
                fetchClassTasksProgress(studentId, lessonId),
                fetchHomeworkTasksProgress(studentId, lessonId)
              ]).then(([classTasks, homeworkTasks]) => {
                return {
                  lessonId: lessonId,
                  classTasks: classTasks,
                  homeworkTasks: homeworkTasks,
                  originalIndex: originalIndex // Store original position
                };
              });
            });
            
            // Wait for all fetches in this batch to complete (all 6 fetches run in parallel)
            const batchResults = await Promise.all(fetchPromises);
            
            // Sort results by originalIndex to ensure correct order (in case promises resolved out of order)
            batchResults.sort((a, b) => a.originalIndex - b.originalIndex);
            
            console.log(`[Group Students Info] Batch results (after sorting):`, batchResults.map(r => r.lessonId));
            
            // Add results to allTasksData, maintaining order
            allTasksData.push(...batchResults);
            
            console.log(`[Group Students Info] ✅ Batch ${batchNumber}/${totalBatches} completed (${batchResults.length} lessons processed)`);
            
            // Small delay between batches to avoid overwhelming the server
            if (i + batchSize < limitedLessonIds.length) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          // Final sort by originalIndex to ensure all lessons are in correct order
          allTasksData.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));
          console.log(`[Group Students Info] ✅ Final ordered lesson IDs:`, allTasksData.map(r => r.lessonId));
          
          console.log(`[Group Students Info] ✅ Completed fetching all tasks data for ${allTasksData.length} lessons`);
          
          // Show modal with all data organized by modules and lessons, pass refresh callback
          showTasksModal(studentId, progressData, allTasksData, loadAndShow);
        } else {
          console.warn(`[Group Students Info] ⚠️ No lesson IDs found in modules data`);
        }
      } else {
        console.warn(`[Group Students Info] ⚠️ Could not fetch modules progress data`);
      }
    };
    
    await loadAndShow();
    
    modulesProgressButton.disabled = false;
    modulesProgressButton.style.opacity = '1';
    modulesProgressButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" fill="currentColor"/>
      </svg>
    `;
  });
  
  buttonsContainer.appendChild(modulesProgressButton);
  
  // Button 4: Class Reminder (icon only)
  const scheduleButton = document.createElement('button');
  scheduleButton.className = 'kodland-wa-btn kodland-schedule-btn';
  scheduleButton.setAttribute('title', 'Enviar advertencia de la clase');
  scheduleButton.setAttribute('aria-label', 'Enviar advertencia de la clase');
  scheduleButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM5 7V6h14v1H5zm2 4h10v-2H7v2zm0 4h7v-2H7v2z" fill="currentColor"/>
    </svg>
  `;
  scheduleButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    try {
      const groupId = extractGroupId();
      if (!groupId) {
        console.error('[Group Students Info] Could not extract group ID from URL');
        alert('No se pudo obtener el ID del grupo');
        return;
      }
      
      const apiUrl = `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/schedule_view/`;
      
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        credentials: 'include',
        headers: headers
      });
      
      if (!response.ok) {
        console.error(`[Group Students Info] HTTP error! status: ${response.status}`);
        alert(`Error al obtener el horario: ${response.status}`);
        return;
      }
      
      const scheduleData = await response.json();
      
      // Find nearest lesson
      const nearestLesson = findNearestLesson(scheduleData);
      
      if (!nearestLesson) {
        alert('No se encontró una clase próxima');
        return;
      }
      
      // Get country code from parent phone
      const countryCode = getCountryInitialsFromPhone(parentPhone);
      const language = detectPageLanguage();
      
      // Generate message
      const message = generateClassReminderMessage(parentName, nearestLesson, countryCode, language);
      
      if (!message) {
        alert('Error al generar el mensaje');
        return;
      }
      
      // Format phone for WhatsApp
      const formattedPhone = formatPhoneForWhatsApp(parentPhone);
      const phoneForUrl = formattedPhone.replace(/^\+/, '');
      
      // Encode message for WhatsApp URL
      const encodedMessage = encodeMessageForWhatsApp(message);
      
      // Open WhatsApp
      const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}&text=${encodedMessage}`;
      window.open(whatsappUrl, '_blank');
      
    } catch (err) {
      console.error('[Group Students Info] Error sending class reminder:', err);
      alert('Error al enviar la advertencia de clase');
    }
  });
  
  buttonsContainer.appendChild(scheduleButton);
  
  // Button 5: Absence notice (student hasn't connected to the live class)
  // Only created if the tutor hasn't hidden it in settings.
  if (getExtensionSettings().showAbsenceButton) {
    const absenceButton = document.createElement('button');
    absenceButton.className = 'kodland-wa-btn kodland-absence-btn';
    absenceButton.setAttribute('title', 'Enviar aviso de falta a clase');
    absenceButton.setAttribute('aria-label', 'Enviar aviso de falta a clase');
    absenceButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
      </svg>
    `;
    absenceButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      console.log('[Group Students Info] Absence button clicked!', { studentId });
      
      if (!formattedPhone) {
        console.error('[Group Students Info] No formatted phone available');
        alert('No hay teléfono disponible para este estudiante');
        return;
      }
      
      const language = detectPageLanguage();
      const studentName = extractStudentName(container);
      const courseName = findCourseName();
      const tutorName = getExtensionSettings().tutorName;
      const message = generateAbsenceMessage(language, { studentName, tutorName, courseName });
      const encodedMessage = encodeMessageForWhatsApp(message);
      
      const phoneForUrl = formattedPhone.replace(/^\+/, '');
      const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}&text=${encodedMessage}`;
      console.log(`[Group Students Info] Sending absence notice to phone: ${formattedPhone}`);
      window.open(whatsappUrl, '_blank');
    });
    
    buttonsContainer.appendChild(absenceButton);
  }
  
  // hasn't submitted yet). Reuses the cached check if available, otherwise
  // fetches on the spot.
  if (getExtensionSettings().showTaskReportButton) {
    const taskReportButton = document.createElement('button');
    taskReportButton.className = 'kodland-wa-btn kodland-task-report-btn';
    taskReportButton.setAttribute('title', 'Enviar por WhatsApp un reporte de tareas sin enviar');
    taskReportButton.innerHTML = `📤`;

    taskReportButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!formattedPhone) {
        alert('No hay teléfono disponible para este estudiante');
        return;
      }

      taskReportButton.disabled = true;
      const originalHtml = taskReportButton.innerHTML;
      taskReportButton.innerHTML = `⏳`;

      try {
        let alerts = studentTaskAlertsCache[studentId];
        if (!alerts) {
          alerts = await fetchStudentTaskAlerts(studentId);
        }

        if (!alerts) {
          alert('No se pudo obtener la información de tareas. Revisa la consola.');
          return;
        }

        if (alerts.notSubmittedTasks.length === 0) {
          alert('Este estudiante no tiene tareas pendientes de enviar. 🎉');
          return;
        }

        const studentName = extractStudentName(container);
        const courseName = findCourseName();
        const tutorName = getExtensionSettings().tutorName;
        const waveEmoji = String.fromCodePoint(0x1F44B);
        const smileEmoji = String.fromCodePoint(0x1F60A);

        // Group missing tasks by lesson (M{module}L{lesson}) instead of
        // repeating the lesson label on every line
        const groupedByLesson = {};
        alerts.notSubmittedTasks.forEach(task => {
          if (!groupedByLesson[task.label]) groupedByLesson[task.label] = [];
          groupedByLesson[task.label].push(task.name);
        });

        const taskListText = Object.entries(groupedByLesson)
          .map(([label, names]) => `${label}:\n` + names.map(name => `• ${name}`).join('\n'))
          .join('\n\n');

        const message = `Hola ${studentName} ${waveEmoji}, soy ${tutorName}, tu tutor${courseName ? ` de ${courseName}` : ''} en Kodland.\nQuería recordarte que tienes pendientes de enviar las siguientes tareas:\n${taskListText}\nPor favor súbelas a la plataforma cuando puedas, para que no te atrases con el curso. ¡Cualquier duda, aquí estoy! ${smileEmoji}`;

        const encodedMessage = encodeMessageForWhatsApp(message);
        const phoneForUrl = formattedPhone.replace(/^\+/, '');
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}&text=${encodedMessage}`;
        window.open(whatsappUrl, '_blank');
      } finally {
        taskReportButton.disabled = false;
        taskReportButton.innerHTML = originalHtml;
      }
    });

    buttonsContainer.appendChild(taskReportButton);
  }

  // Button: send the recording link of the last (already happened) class
  // straight to this student's parent via WhatsApp.
  if (getExtensionSettings().showRecordingButton) {
    const recordingButton = document.createElement('button');
    recordingButton.className = 'kodland-wa-btn kodland-recording-btn';
    recordingButton.setAttribute('title', 'Enviar link de la grabación de la última clase');
    recordingButton.setAttribute('aria-label', 'Enviar link de la grabación de la última clase');
    recordingButton.innerHTML = `🎥`;

    recordingButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (!formattedPhone) {
        alert('No hay teléfono disponible para este estudiante');
        return;
      }

      recordingButton.disabled = true;
      const originalHtml = recordingButton.innerHTML;
      recordingButton.innerHTML = `⏳`;

      try {
        const groupId = extractGroupId();
        const { link: recordingLink } = await getLastClassRecordingLink(groupId);

        if (!recordingLink) {
          alert('No se envió nada: no se indicó el link de la grabación.');
          return;
        }

        const studentName = extractStudentName(container);
        const courseName = findCourseName() || 'tu curso';
        const settings = getExtensionSettings();

        const message = renderTemplate(settings.recordingStudentTemplate || DEFAULT_RECORDING_STUDENT_TEMPLATE, {
          studentName,
          courseName,
          tutorName: settings.tutorName,
          recordingLink
        });

        const encodedMessage = encodeMessageForWhatsApp(message);
        const phoneForUrl = formattedPhone.replace(/^\+/, '');
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneForUrl}&text=${encodedMessage}`;
        console.log(`[Group Students Info] Enviando link de grabación a: ${formattedPhone}`);
        window.open(whatsappUrl, '_blank');
      } finally {
        recordingButton.disabled = false;
        recordingButton.innerHTML = originalHtml;
      }
    });

    buttonsContainer.appendChild(recordingButton);
  }
  
  // Add data attribute to identify which student these buttons belong to
  buttonsContainer.setAttribute('data-student-id', studentId);
  
  // Verify buttons are in container
  console.log('[Group Students Info] Buttons container prepared:', {
    buttonCount: buttonsContainer.children.length,
    buttons: Array.from(buttonsContainer.children).map(b => b.className)
  });
  
  // Insert buttons OUTSIDE the <a> tag, after the <a> element
  // This prevents clicking buttons from opening the student profile
  if (studentLink && studentLink.parentElement) {
    // Insert buttons after the <a> element
    if (studentLink.nextSibling) {
      studentLink.parentElement.insertBefore(buttonsContainer, studentLink.nextSibling);
    } else {
      studentLink.parentElement.appendChild(buttonsContainer);
    }
    
    console.log('[Group Students Info] ✅ Buttons inserted OUTSIDE student link:', {
      studentName: studentH3.textContent?.trim(),
      buttonsContainer: buttonsContainer,
      parentElement: studentLink.parentElement,
      isInDOM: document.body.contains(buttonsContainer),
      buttonsInDOM: Array.from(buttonsContainer.children).map(b => ({
        className: b.className,
        inDOM: document.body.contains(b)
      }))
    });
  } else {
    // Fallback: try to insert after h3's parent (the <a>)
    const linkParent = studentH3.parentElement?.parentElement;
    if (linkParent) {
      linkParent.insertBefore(buttonsContainer, studentH3.parentElement?.nextSibling || null);
      if (!linkParent.contains(buttonsContainer)) {
        linkParent.appendChild(buttonsContainer);
      }
    } else {
      console.warn('[Group Students Info] Could not find parent to insert buttons outside link');
    }
  }
  
  console.log(`[Group Students Info] Created buttons for student ${studentId} (Parent: ${parentName}, Phone: ${parentPhone})`);
}

// Function to wait for auth token to be captured
async function waitForAuthToken(maxWaitTime = 10000) {
  const startTime = Date.now();
  
  while (!authToken && (Date.now() - startTime) < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  if (authToken) {
    console.log('[Group Students Info] ✅ Auth token available');
    return true;
  } else {
    console.warn('[Group Students Info] ⚠️ Auth token not captured after waiting');
    return false;
  }
}

// Function to process all students
async function processAllStudents() {
  if (!isGroupPage()) {
    return;
  }
  
  // Prevent multiple simultaneous executions
  if (isProcessingStudents) {
    console.log('[Group Students Info] Already processing students, skipping duplicate call');
    return;
  }
  
  const students = findStudentElements();
  
  if (students.length === 0) {
    console.log('[Group Students Info] No students found');
    return;
  }
  
  // Helper: decide if a student still needs processing
  const needsProcessing = (student) => {
    // If never processed, we need to process
    if (!processedStudents.has(student.id)) return true;
    
    // If processed before, verify the buttons still exist (Vue re-renders can remove them)
    const selector = `.kodland-student-buttons[data-student-id="${student.id}"]`;
    const hasButtons =
      student.container.querySelector(selector) ||
      student.container.querySelector('.kodland-student-buttons');
    
    return !hasButtons;
  };
  
  // Check if all students are already processed or missing buttons
  const unprocessedStudents = students.filter(needsProcessing);
  if (unprocessedStudents.length === 0) {
    console.log('[Group Students Info] All students already processed');
    return;
  }
  
  isProcessingStudents = true;
  console.log(`[Group Students Info] Starting to process ${unprocessedStudents.length} new students...`);
  
  // Wait for auth token before processing
  const hasToken = await waitForAuthToken(10000);
  
  if (!hasToken) {
    console.error('[Group Students Info] ❌ Cannot proceed without auth token. Please refresh the page or wait for network activity.');
    isProcessingStudents = false;
    // Show error message in UI only for unprocessed students
    unprocessedStudents.forEach(student => {
      displayStudentInfo(student.container, null, student.id);
      const infoElement = student.container.querySelector('.kodland-student-buttons');
      if (infoElement) {
        infoElement.innerHTML = '<span style="color: #d32f2f;">❌ Authentication error. Please refresh the page.</span>';
      }
    });
    return;
  }
  
  // Mark all unprocessed students as processing
  unprocessedStudents.forEach(student => {
    if (!processedStudents.has(student.id)) {
      processedStudents.add(student.id);
    }
  });
  
  console.log(`[Group Students Info] 🚀 Starting parallel fetch for ${unprocessedStudents.length} students...`);
  
  // Log student info before processing
  unprocessedStudents.forEach((student, i) => {
    console.log(`[Group Students Info] 📝 Student ${i + 1}/${unprocessedStudents.length}: ${student.name} (ID: ${student.id})`);
  });
  
  // Create all fetch promises to execute in parallel
  const fetchPromises = unprocessedStudents.map(async (student) => {
    try {
      // Fetch student info asynchronously
      const studentData = await fetchStudentInfo(student.id);
      
      return {
        student: student,
        studentData: studentData,
        success: !!studentData
      };
    } catch (error) {
      console.error(`[Group Students Info] ❌ Error fetching data for student ${student.id}:`, error);
      return {
        student: student,
        studentData: null,
        success: false
      };
    }
  });
  
  // Wait for all fetches to complete in parallel
  const results = await Promise.all(fetchPromises);
  
  console.log(`[Group Students Info] ✅ All ${results.length} fetches completed. Processing results...`);
  
  // Process results and display in UI
  results.forEach((result, i) => {
    const { student, studentData, success } = result;
    
    // Cache full student data for later use (e.g. contacts CSV export)
    if (studentData) {
      studentGeneralInfoCache[student.id] = studentData;
    }
    
    // Display info in UI with guard to avoid breaking when Vue proxies misbehave
    try {
      displayStudentInfo(student.container, studentData, student.id);
    } catch (error) {
      console.error('[Group Students Info] ❌ Error rendering buttons for student', student.id, error);
    }
    
    // Log summary after processing
    if (success && studentData) {
      console.log(`[Group Students Info] ✅ Completed processing for ${student.name} (${i + 1}/${results.length})`);
    } else {
      console.log(`[Group Students Info] ⚠️ No data received for ${student.name} (${i + 1}/${results.length})`);
      // Remove from processed set if failed, so it can be retried
      processedStudents.delete(student.id);
    }
  });
  
  isProcessingStudents = false;
  console.log(`[Group Students Info] Finished processing ${unprocessedStudents.length} students`);
}

// ---------------------------------------------------------------------
// Extension settings (persisted in localStorage, per browser profile)
// ---------------------------------------------------------------------
const DEFAULT_WELCOME_TEMPLATE = `Hola {{studentName}} 👋
Un cordial saludo. Mi nombre es {{tutorName}} y seré tu tutor en la clase de {{courseName}}, {{scheduleLine}}. Estamos muy contentos de que formes parte de esta experiencia en Kodland. Para estar listos para nuestra primera clase, por favor sigue estos pasos:
🔹 Únete al grupo oficial de WhatsApp, donde compartiremos el enlace de la clase por Zoom y toda la información importante: 👉{{waGroupLink}}
🔹 Aquí tienes tu acceso personalizado a la plataforma Kodland:
• Enlace de acceso directo: {{wonderLoginUrl}}
Inicio de sesión: {{username}}
Contraseña: {{password}}
Estoy aquí para ayudarte en todo lo que necesites. ¡Nos vemos pronto!
Un saludo,
{{tutorName}}
Tutor de {{courseName}}`;

const DEFAULT_ABSENCE_TEMPLATE = `Hola {{studentName}} 👋, soy {{tutorName}}, tu tutor de {{courseName}} en Kodland.
Ya estamos iniciando nuestra clase de hoy y he notado que aún no te has conectado. ¿Vas a asistir a la sesión? 🕒
Si tienes algún inconveniente técnico para ingresar a la plataforma, por favor avísame de inmediato para ayudarte. Recuerda que si no logras conectarte en vivo, es muy importante que revises la grabación de la clase en tu panel de estudiante para que no te quedes atrás con el proyecto que estamos trabajando.
¡Te esperamos en la sala! 😊`;

// Broadcast messages, meant to be sent to the WHATSAPP GROUP (not to a
// single student), copied to clipboard and opened via the group chat link.

const DEFAULT_CLASS_STARTING_TEMPLATE = `¡Hola a todos! 👋
Hoy nos espera una nueva clase de {{courseName}} a las {{time}} (hora Colombia).
🚀 Nos vemos directo en la Plataforma de Kodland, como siempre. ¡Entren con toda la energía! 💻
Si alguien tiene algún detalle con su entrada, escríbanme por aquí rápido. 🔑
¡Nos vemos en un rato! 🔥
{{tutorName}}`;

const DEFAULT_IN_CLASS_TEMPLATE = `¡Hola a todos! 😊
¡Ya estoy listo en nuestra aula dentro de la Plataforma de Kodland para empezar nuestra clase de {{courseName}}! 🚀
Entren ahora mismo para que podamos comenzar. Si alguien tiene algún inconveniente con sus accesos, escríbeme por privado y lo solucionamos de inmediato. 🔑
¡Los espero con muchas ganas de crear y aprender juntos! 🎉
{{tutorName}}`;

const DEFAULT_GRADUATION_TEMPLATE = `🎉 ¡Hola, queridos padres y alumnos!
Estamos llegando al final de nuestro camino en el curso de {{courseName}} y nos preparamos para nuestra gran Lección de Graduación.
📅 Fecha: {{gradDate}}
⏰ Hora: {{gradTime}} (Hora Colombia)
✨ Invitación: Todos los padres y familiares están cordialmente invitados a celebrar el esfuerzo de los chicos.
🌟 ¿Qué haremos en la graduación?
• Resultados del curso: un resumen de los temas y objetivos alcanzados durante el curso.
• Presentación de proyectos: cada estudiante compartirá su creación final. ¡Han hecho un trabajo increíble!
• Orientación personalizada: comentarios sobre el desempeño de cada alumno y consejos para seguir aprendiendo.
🧑‍💻 Preparativos importantes para los estudiantes:
• Revisar y completar las últimas actividades pendientes en la plataforma antes de la clase.
• Preparar su fondo virtual de graduación para la videollamada: https://drive.google.com/drive/folders/1bu8VJJdUXnG9fzqPYXvBYvEQeYq3hXTV
• Elegir qué proyecto van a presentar (su mejor trabajo o portafolio del curso).
⏱ Cada estudiante tendrá unos minutos para su presentación.
🕒 La clase será en el horario habitual, con este enfoque especial de celebración. La asistencia de todos es muy importante, ya que es el espacio donde los alumnos cierran su ciclo y validan lo aprendido.
Si por algún motivo de fuerza mayor no pueden asistir, por favor házmelo saber con antelación.
¡Nos vemos en clase para celebrar su talento! 💙
Equipo Kodland
Tutor: {{tutorName}}`;

const DEFAULT_GROUP_WELCOME_TEMPLATE = `👋✨ ¡Hola a todos!
Bienvenidos al curso de {{courseName}}. Estoy muy emocionado de comenzar este viaje con ustedes, donde aprenderemos y construiremos proyectos que combinan creatividad, funcionalidad y estilo.
En este espacio, la imaginación y las ganas de aprender serán nuestras herramientas principales. Exploraremos nuevos temas, experimentaremos con ideas y daremos vida a proyectos únicos que reflejen su talento.
🚀 Estoy seguro de que será el inicio de una gran experiencia, donde podrán desarrollar habilidades útiles y divertirse aprendiendo.
📩 Por favor, revisen su correo electrónico, allí encontrarán sus credenciales de acceso para iniciar sesión en la plataforma de Kodland.
💻✨ ¡Prepárense para aprender, crear y dejar su huella!
{{tutorName}}`;

const DEFAULT_FIRST_CLASS_TEMPLATE = `🎉 ¡Bienvenidos a su primera clase de {{courseName}} en Kodland! 🎉
¡Hola chicos y chicas! Estoy muy emocionado de darles la bienvenida oficial a este nuevo curso, donde aprenderemos cosas increíbles combinando creatividad, tecnología y mucho entusiasmo. 🌐✨
Hoy comienza una aventura en la que ustedes serán los protagonistas. En cada clase exploraremos nuevas herramientas y formas de expresión para dar vida a sus ideas. No se preocupen si es su primera vez en este tipo de curso, ¡vamos a aprender paso a paso y a disfrutar el proceso! 🚀
🚨 Recordatorio Importante: Nos vemos en la plataforma 🚨
Les recuerdo que para nuestra clase de HOY a las {{time}} (hora Colombia), nos conectaremos directamente a través de la plataforma de Kodland.
Esta es nuestra primera clase juntos, así que no se preocupen si tienen dudas de cómo nos manejamos en el aula virtual… ¡estamos aquí para disfrutar y crecer juntos paso a paso!
🛠️ Antes de que empiece la clase, asegúrate de esto:
✅ ¿Ya probaste entrar? Inicia sesión en la plataforma con las credenciales que recibieron por correo electrónico. Hazlo un momento antes para confirmar que todo esté en orden y no perder valiosos minutos de clase.
📖 ¿Dudas de cómo ingresar? Aquí tienes el instructivo a la mano por si necesitas refrescar los pasos: https://docs.google.com/document/d/1HtCjckqbetfsSX0YWzuEHYAt53BgrPbdDNZwg4G4Jno/edit?tab=t.0#heading=h.ta5cgks4cr63
🔑 ¿Problemas con tus datos? Si has revisado tu bandeja de entrada y aun así no has podido ingresar con tus credenciales, escríbeme YA MISMO por privado para ayudarte a solucionarlo.
⚠️ Requisito clave: Para que todas las herramientas funcionen a la perfección, asegúrense de entrar usando el navegador Google Chrome. 🌐
✨ No olviden traer su creatividad, curiosidad y entusiasmo. ¡Estoy muy feliz de ser su profe y acompañarlos en este viaje de aprendizaje!
¡Nos vemos en un rato dentro de la plataforma! 🔥🙌
💡 ¡Vamos a construir cosas increíbles juntos! 🌐🚀
{{tutorName}}`;

const DEFAULT_RECORDING_STUDENT_TEMPLATE = `🎥 ¡Hola {{studentName}}!
Te comparto la grabación de nuestra última clase de {{courseName}}, por si quieres repasar algo o no pudiste conectarte en vivo:
🔗 {{recordingLink}}
Cualquier duda que te quede, aquí estoy para ayudarte. ¡Sigamos avanzando! 🚀
{{tutorName}}`;

const DEFAULT_RECORDING_GROUP_TEMPLATE = `🎥 ¡Hola a todos!
Les comparto la grabación de nuestra última clase de {{courseName}}, por si quieren repasar algo o alguien no pudo conectarse en vivo:
🔗 {{recordingLink}}
Cualquier duda, aquí estoy para ayudarles. ¡Sigamos aprendiendo! 🚀
{{tutorName}}`;

// Fill in a template string, replacing {{placeholder}} tokens with values
// from `vars`. Unknown placeholders are left as-is (so a typo doesn't
// silently delete text).
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = vars[key];
    return (value !== undefined && value !== null) ? value : match;
  });
}

const DEFAULT_KODLAND_SETTINGS = {
  showExportContacts: true,
  showWaGroupLink: true,
  showAbsenceButton: true,
  showTaskReportButton: true,
  showRecordingButton: true,
  showGroupGradingReport: true,
  showBroadcastButtons: true,
  tutorName: 'Gehiner Sierra',
  welcomeTemplate: DEFAULT_WELCOME_TEMPLATE,
  absenceTemplate: DEFAULT_ABSENCE_TEMPLATE,
  classStartingTemplate: DEFAULT_CLASS_STARTING_TEMPLATE,
  inClassTemplate: DEFAULT_IN_CLASS_TEMPLATE,
  graduationTemplate: DEFAULT_GRADUATION_TEMPLATE,
  groupWelcomeTemplate: DEFAULT_GROUP_WELCOME_TEMPLATE,
  firstClassTemplate: DEFAULT_FIRST_CLASS_TEMPLATE,
  recordingStudentTemplate: DEFAULT_RECORDING_STUDENT_TEMPLATE,
  recordingGroupTemplate: DEFAULT_RECORDING_GROUP_TEMPLATE
};

function getExtensionSettings() {
  try {
    const raw = localStorage.getItem('kodland_ext_settings');
    if (!raw) return { ...DEFAULT_KODLAND_SETTINGS };
    return { ...DEFAULT_KODLAND_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    console.warn('[Settings] Error reading settings, using defaults:', error);
    return { ...DEFAULT_KODLAND_SETTINGS };
  }
}

function saveExtensionSettings(settings) {
  localStorage.setItem('kodland_ext_settings', JSON.stringify(settings));
}

// Inject the floating "⚙️ Settings" button (always visible, so the tutor
// can always get back in and re-enable anything they hid)
function injectSettingsButton() {
  if (!isGroupPage()) return;
  if (document.getElementById('kodland-settings-button')) return;

  const button = document.createElement('button');
  button.id = 'kodland-settings-button';
  button.className = 'kodland-toolbar-btn kodland-settings-btn';
  button.innerHTML = '⚙️';
  button.setAttribute('title', 'Configuración de la extensión (mostrar/ocultar botones, nombre del tutor)');

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSettingsModal();
  });

  getOrCreateToolbar().appendChild(button);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function openSettingsModal() {
  if (document.getElementById('kodland-settings-modal')) return;
  const settings = getExtensionSettings();

  const modal = document.createElement('div');
  modal.id = 'kodland-settings-modal';
  modal.className = 'kodland-modal';
  modal.innerHTML = `
    <div class="kodland-modal-content" style="max-width: 560px;">
      <div class="kodland-modal-header">
        <h2>⚙️ Configuración</h2>
        <button class="kodland-modal-close">&times;</button>
      </div>
      <div class="kodland-modal-body">
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-export" ${settings.showExportContacts ? 'checked' : ''}/>
          <span>📇 Mostrar botón "Exportar contactos"</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-walink" ${settings.showWaGroupLink ? 'checked' : ''}/>
          <span>💬 Mostrar botón "Link WA grupo"</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-absence" ${settings.showAbsenceButton ? 'checked' : ''}/>
          <span>⏰ Mostrar botón "Falta a clase" (por estudiante)</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-taskreport" ${settings.showTaskReportButton ? 'checked' : ''}/>
          <span>📤 Mostrar botón "Reporte de tareas" (por estudiante)</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-recording" ${settings.showRecordingButton ? 'checked' : ''}/>
          <span>🎥 Mostrar botón "Grabación última clase" (por estudiante)</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-gradingreport" ${settings.showGroupGradingReport ? 'checked' : ''}/>
          <span>📊 Mostrar botón "Reporte calificación" (grupo completo)</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:20px; cursor:pointer;">
          <input type="checkbox" id="kodland-setting-broadcast" ${settings.showBroadcastButtons ? 'checked' : ''}/>
          <span>📢 Mostrar botones de aviso al grupo (clase, en clase, graduación, bienvenida, grabación)</span>
        </label>

        <label style="display:block; margin-bottom:8px; font-size:13px; color:#bbb;">Nombre del tutor:</label>
        <input type="text" id="kodland-setting-tutorname" value="${escapeHtml(settings.tutorName)}"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px;"/>

        <hr style="border-color:#333; margin: 16px 0;"/>
        <p style="font-size:12px; color:#999; margin-bottom:16px;">
          Plantillas de mensajes: usa <code>{{studentName}}</code>, <code>{{tutorName}}</code>, <code>{{courseName}}</code>,
          <code>{{time}}</code>, <code>{{gradDate}}</code>, <code>{{gradTime}}</code>, <code>{{recordingLink}}</code>
          y (solo en bienvenida individual) <code>{{scheduleLine}}</code>, <code>{{waGroupLink}}</code>, <code>{{wonderLoginUrl}}</code>,
          <code>{{username}}</code>, <code>{{password}}</code>. Esos textos se rellenan solos al enviar el mensaje.
        </p>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">Mensaje de bienvenida (individual, por estudiante):</label>
          <button id="kodland-reset-welcome" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-welcome-template" rows="8"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.welcomeTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">Mensaje de falta a clase (individual, por estudiante):</label>
          <button id="kodland-reset-absence" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-absence-template" rows="6"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.absenceTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">📢 Aviso de clase (al grupo de WhatsApp):</label>
          <button id="kodland-reset-classstarting" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-classstarting-template" rows="6"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.classStartingTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">▶️ Estamos en clase (al grupo de WhatsApp):</label>
          <button id="kodland-reset-inclass" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-inclass-template" rows="6"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.inClassTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">🎓 Graduación (al grupo de WhatsApp):</label>
          <button id="kodland-reset-graduation" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-graduation-template" rows="10"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.graduationTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">🎉 Bienvenida al grupo (al grupo de WhatsApp):</label>
          <button id="kodland-reset-groupwelcome" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-groupwelcome-template" rows="5"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.groupWelcomeTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">🎉 Primera clase (al grupo de WhatsApp):</label>
          <button id="kodland-reset-firstclass" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-firstclass-template" rows="10"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.firstClassTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">🎥 Grabación última clase (individual, por estudiante):</label>
          <button id="kodland-reset-recording-student" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-recording-student-template" rows="6"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.recordingStudentTemplate)}</textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:13px; color:#bbb;">🎥 Grabación última clase (al grupo de WhatsApp):</label>
          <button id="kodland-reset-recording-group" type="button" style="background:none; border:none; color:#25D366; font-size:12px; cursor:pointer; text-decoration:underline;">Restablecer</button>
        </div>
        <textarea id="kodland-setting-recording-group-template" rows="6"
          style="width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid #444; background:#1e1e1e; color:#fff; margin-bottom:20px; font-family:monospace; font-size:12px;">${escapeHtml(settings.recordingGroupTemplate)}</textarea>

        <button id="kodland-settings-save" class="kodland-wa-btn" style="width:100%; justify-content:center;">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('.kodland-modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  modal.querySelector('#kodland-reset-welcome').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-welcome-template').value = DEFAULT_WELCOME_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-absence').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-absence-template').value = DEFAULT_ABSENCE_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-classstarting').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-classstarting-template').value = DEFAULT_CLASS_STARTING_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-inclass').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-inclass-template').value = DEFAULT_IN_CLASS_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-graduation').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-graduation-template').value = DEFAULT_GRADUATION_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-groupwelcome').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-groupwelcome-template').value = DEFAULT_GROUP_WELCOME_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-firstclass').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-firstclass-template').value = DEFAULT_FIRST_CLASS_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-recording-student').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-recording-student-template').value = DEFAULT_RECORDING_STUDENT_TEMPLATE;
  });
  modal.querySelector('#kodland-reset-recording-group').addEventListener('click', () => {
    modal.querySelector('#kodland-setting-recording-group-template').value = DEFAULT_RECORDING_GROUP_TEMPLATE;
  });

  modal.querySelector('#kodland-settings-save').addEventListener('click', () => {
    const newSettings = {
      showExportContacts: modal.querySelector('#kodland-setting-export').checked,
      showWaGroupLink: modal.querySelector('#kodland-setting-walink').checked,
      showAbsenceButton: modal.querySelector('#kodland-setting-absence').checked,
      showTaskReportButton: modal.querySelector('#kodland-setting-taskreport').checked,
      showRecordingButton: modal.querySelector('#kodland-setting-recording').checked,
      showGroupGradingReport: modal.querySelector('#kodland-setting-gradingreport').checked,
      showBroadcastButtons: modal.querySelector('#kodland-setting-broadcast').checked,
      tutorName: modal.querySelector('#kodland-setting-tutorname').value.trim() || DEFAULT_KODLAND_SETTINGS.tutorName,
      welcomeTemplate: modal.querySelector('#kodland-setting-welcome-template').value.trim() || DEFAULT_WELCOME_TEMPLATE,
      absenceTemplate: modal.querySelector('#kodland-setting-absence-template').value.trim() || DEFAULT_ABSENCE_TEMPLATE,
      classStartingTemplate: modal.querySelector('#kodland-setting-classstarting-template').value.trim() || DEFAULT_CLASS_STARTING_TEMPLATE,
      inClassTemplate: modal.querySelector('#kodland-setting-inclass-template').value.trim() || DEFAULT_IN_CLASS_TEMPLATE,
      graduationTemplate: modal.querySelector('#kodland-setting-graduation-template').value.trim() || DEFAULT_GRADUATION_TEMPLATE,
      groupWelcomeTemplate: modal.querySelector('#kodland-setting-groupwelcome-template').value.trim() || DEFAULT_GROUP_WELCOME_TEMPLATE,
      firstClassTemplate: modal.querySelector('#kodland-setting-firstclass-template').value.trim() || DEFAULT_FIRST_CLASS_TEMPLATE,
      recordingStudentTemplate: modal.querySelector('#kodland-setting-recording-student-template').value.trim() || DEFAULT_RECORDING_STUDENT_TEMPLATE,
      recordingGroupTemplate: modal.querySelector('#kodland-setting-recording-group-template').value.trim() || DEFAULT_RECORDING_GROUP_TEMPLATE
    };
    saveExtensionSettings(newSettings);
    modal.remove();
    alert('Configuración guardada. Recarga la página para que se aplique.');
  });
}

// Function to build and download a CSV with contacts, ready to import into
// phone/Google contacts: First Name / Last Name (= course + " Kodland") / Phone.
async function exportContactsCSV() {
  const courseName = findCourseName() || 'Kodland';

  // Build "Last Name" as {Día}{Hora}horas-Kodland (e.g. "Martes10horas-Kodland"),
  // based on the course's first lesson (M1L1) day/time.
  const groupId = extractGroupId();
  const firstLesson = groupId ? await fetchFirstLessonForGroup(groupId) : null;
  const lessonDateInfo = firstLesson ? formatLessonDateForMessage(firstLesson.timetable_time) : null;

  let apellido = 'Kodland';
  if (lessonDateInfo) {
    const capitalizedDay = lessonDateInfo.dayName.charAt(0).toUpperCase() + lessonDateInfo.dayName.slice(1);
    const hourOnly = lessonDateInfo.time.split(':')[0];
    apellido = `${capitalizedDay}${hourOnly}horas-Kodland`;
  } else {
    console.warn('[Export Contacts] ⚠️ No se pudo obtener el horario de la primera clase, usando "Kodland" como respaldo');
  }

  // Google Contacts import format that's confirmed to work: semicolon-separated,
  // with an empty "Name Prefix" column and phone as " +NUMBER" (one leading space).
  const rows = [['Name Prefix', 'First Name', 'Last Name', 'Phone 1 - Value']];

  Object.keys(studentGeneralInfoCache).forEach(studentId => {
    const data = studentGeneralInfoCache[studentId];
    if (!data) return;

    const nombre = (data.student_full_name || data.student_first_name || `Estudiante ${studentId}`).trim();
    const phoneRaw = data.parent_phone || data.student_phone || '';
    const formattedPhone = formatPhoneForWhatsApp(phoneRaw);

    if (!formattedPhone) {
      console.warn(`[Export Contacts] Sin teléfono válido para estudiante ${studentId}, se omite`);
      return;
    }

    // formatPhoneForWhatsApp may or may not include a leading "+" depending
    // on which same-named function wins (several files define one) - strip
    // it first so we always add exactly one, never two.
    const phoneDigitsOnly = String(formattedPhone).replace(/^\+/, '');

    rows.push(['', nombre, apellido, ` +${phoneDigitsOnly}`]);
  });

  if (rows.length <= 1) {
    alert('Todavía no hay estudiantes procesados. Espera unos segundos a que carguen los datos y vuelve a intentar.');
    return;
  }

  const csvContent = rows
    .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  // Add BOM so Excel/Sheets open accents correctly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const safeCourseName = courseName.replace(/[^a-z0-9]+/gi, '_');

  const link = document.createElement('a');
  link.href = url;
  link.download = `contactos_${safeCourseName}_${groupId || 'grupo'}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  console.log(`[Export Contacts] ✅ CSV descargado con ${rows.length - 1} contactos`);
}

// Function to inject the floating "Export contacts" button (once per group page)
function injectExportContactsButton() {
  if (!isGroupPage()) return;
  if (!getExtensionSettings().showExportContacts) return;
  if (document.getElementById('kodland-export-contacts-button')) return;

  const button = document.createElement('button');
  button.id = 'kodland-export-contacts-button';
  button.className = 'kodland-toolbar-btn kodland-export-contacts-btn';
  button.setAttribute('title', 'Descargar CSV de contactos (Nombre, Día+Hora, Teléfono)');
  button.innerHTML = `📇 Exportar contactos`;

  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    button.disabled = true;
    const originalLabel = button.innerHTML;
    button.innerHTML = `⏳ Exportando...`;
    try {
      await exportContactsCSV();
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  });

  getOrCreateToolbar().appendChild(button);
  console.log('[Group Students Info] ✅ Botón "Exportar contactos" inyectado');
}

// Function to inject the floating "WhatsApp group link" status button.
// Shows whether the link has been captured for this group; clicking it
// lets the tutor view or manually paste/correct the link.
function injectWhatsAppGroupLinkButton() {
  if (!isGroupPage()) return;
  if (!getExtensionSettings().showWaGroupLink) return;
  if (document.getElementById('kodland-wa-group-link-button')) return;

  const groupId = extractGroupId();

  const button = document.createElement('button');
  button.id = 'kodland-wa-group-link-button';
  button.className = 'kodland-toolbar-btn kodland-wa-group-link-btn';

  const refreshLabel = () => {
    const link = getGroupWhatsAppLink(groupId);
    const cachedChatLink = groupId ? getCachedGroupGeneralInfo(groupId)?.chat_link : null;
    const isAuto = !!(link && cachedChatLink && cachedChatLink === link);

    if (link) {
      button.innerHTML = isAuto ? '✅ Link WA grupo' : '✏️ Link WA grupo (manual)';
    } else {
      button.innerHTML = '📋 Pegar link WA grupo';
    }
    button.setAttribute('title', link
      ? `Link ${isAuto ? 'detectado automáticamente' : 'guardado manualmente'}: ${link}\nClic para verlo o corregirlo.`
      : 'No se pudo detectar el link automáticamente todavía. Clic para pegarlo manualmente.');
  };

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!groupId) return;

    const current = getGroupWhatsAppLink(groupId) || '';
    const input = prompt('Pega o corrige el link del grupo de WhatsApp de este curso:', current);
    if (input === null) return; // cancelled
    if (input.trim() === '') {
      localStorage.removeItem(`kodland_wa_group_link_${groupId}`);
    } else {
      localStorage.setItem(`kodland_wa_group_link_${groupId}`, input.trim());
    }
    refreshLabel();
  });

  refreshLabel();
  getOrCreateToolbar().appendChild(button);
  console.log('[Group Students Info] ✅ Botón de link de WhatsApp del grupo inyectado');

  // Try to auto-detect the link (and cache the rest of the group info)
  // in the background; update the button label once we know either way.
  if (groupId) {
    fetchGroupGeneralInfo(groupId).then(() => refreshLabel());
  }
}

// Function to initialize the module
// ---------------------------------------------------------------------
// Broadcast messages to the WhatsApp GROUP (class starting, in class,
// graduation, group welcome). Since a WhatsApp group link can't carry a
// pre-filled message, we copy the text to the clipboard and open the
// group chat so the tutor just has to paste and send.
// ---------------------------------------------------------------------

// Opens (or reuses) the WhatsApp tab for a group. IMPORTANT: call this
// synchronously, as the very first thing in a click handler - before any
// `await` - otherwise the delay from fetching lesson times etc. can push
// window.open() outside the click's "user gesture" window and Chrome's
// popup blocker silently swallows it (no tab, no error, looks like the
// button "just doesn't work").
function openGroupWhatsApp(groupIdOverride = null) {
  const groupId = groupIdOverride || extractGroupId();
  const cachedLink = getGroupWhatsAppLink(groupId);

  // Open the tab synchronously no matter what, so it stays inside the
  // click's "user gesture" window and Chrome doesn't block it. If we
  // already have the link, great - open straight to the group's chat.
  const waWindow = window.open(cachedLink || 'https://web.whatsapp.com/', '_blank');

  if (cachedLink || !groupId) return waWindow;

  // We didn't have the link cached yet (common right when the schedule
  // modal opens on a page other than the group page itself, or if this
  // fires before the group page's initial fetch finished). Fetch it now
  // and redirect the tab we already opened once it resolves, instead of
  // silently leaving the tutor on generic WhatsApp Web with no chat open
  // (which is also why the queued message never gets pasted anywhere).
  fetchGroupGeneralInfo(groupId).then(() => {
    const link = getGroupWhatsAppLink(groupId);
    if (link && waWindow && !waWindow.closed) {
      waWindow.location = link;
    }
  });

  return waWindow;
}

// Copies the message and queues it for the WhatsApp Web autopaste script.
// Does NOT open any window - call openGroupWhatsApp() separately (and
// first) for that.
async function queueGroupBroadcastMessage(message) {
  // Always copy to clipboard too, as a fallback in case the auto-paste
  // script can't find WhatsApp Web's compose box (Ctrl+V still works then).
  try {
    await navigator.clipboard.writeText(message);
  } catch (error) {
    console.warn('[Broadcast] No se pudo copiar al portapapeles:', error);
  }

  // Queue the message so the WhatsApp Web autopaste script picks it up
  // and drops it into the compose box automatically.
  try {
    await chrome.storage.local.set({
      kodland_pending_wa_message: { message, timestamp: Date.now() }
    });
  } catch (error) {
    console.warn('[Broadcast] No se pudo guardar el mensaje pendiente para autopegado:', error);
  }
}

async function sendClassStartingBroadcast() {
  const groupId = extractGroupId();
  const courseName = findCourseName() || 'tu curso';
  const settings = getExtensionSettings();

  const nearestLesson = groupId ? await fetchNearestLessonForGroup(groupId) : null;
  const lessonDateInfo = nearestLesson ? formatLessonDateForMessage(nearestLesson.timetable_time) : null;
  const time = lessonDateInfo ? lessonDateInfo.time : (prompt('No pude detectar la hora automáticamente. ¿A qué hora es la clase? (ej: 6:00 p.m.)') || '');

  const message = renderTemplate(settings.classStartingTemplate || DEFAULT_CLASS_STARTING_TEMPLATE, {
    courseName,
    time,
    tutorName: settings.tutorName
  });

  await queueGroupBroadcastMessage(message);
}

async function sendFirstClassBroadcast() {
  const groupId = extractGroupId();
  const courseName = findCourseName() || 'tu curso';
  const settings = getExtensionSettings();

  const nearestLesson = groupId ? await fetchNearestLessonForGroup(groupId) : null;
  const lessonDateInfo = nearestLesson ? formatLessonDateForMessage(nearestLesson.timetable_time) : null;
  const time = lessonDateInfo ? lessonDateInfo.time : (prompt('No pude detectar la hora automáticamente. ¿A qué hora es la clase? (ej: 7:00 p.m.)') || '');

  const message = renderTemplate(settings.firstClassTemplate || DEFAULT_FIRST_CLASS_TEMPLATE, {
    courseName,
    time,
    tutorName: settings.tutorName
  });

  await queueGroupBroadcastMessage(message);
}

async function sendRecordingBroadcast() {
  const groupId = extractGroupId();
  const courseName = findCourseName() || 'tu curso';
  const settings = getExtensionSettings();

  const { link: recordingLink } = await getLastClassRecordingLink(groupId);
  if (!recordingLink) {
    alert('No se envió nada: no se indicó el link de la grabación.');
    return;
  }

  const message = renderTemplate(settings.recordingGroupTemplate || DEFAULT_RECORDING_GROUP_TEMPLATE, {
    courseName,
    tutorName: settings.tutorName,
    recordingLink
  });

  await queueGroupBroadcastMessage(message);
}

async function sendInClassBroadcast() {
  const courseName = findCourseName() || 'tu curso';
  const settings = getExtensionSettings();

  const message = renderTemplate(settings.inClassTemplate || DEFAULT_IN_CLASS_TEMPLATE, {
    courseName,
    tutorName: settings.tutorName
  });

  await queueGroupBroadcastMessage(message);
}

async function sendGraduationBroadcast() {
  const groupId = extractGroupId();
  const courseName = findCourseName() || 'tu curso';
  const settings = getExtensionSettings();

  const lastLesson = groupId ? await fetchLastLessonForGroup(groupId) : null;
  const lastLessonInfo = lastLesson ? formatLessonDateForMessage(lastLesson.timetable_time) : null;
  const suggestedDate = lastLessonInfo ? `${lastLessonInfo.dayName} ${lastLessonInfo.fullDate}` : '';
  const suggestedTime = lastLessonInfo ? lastLessonInfo.time : '';

  const gradDate = prompt('Fecha de la graduación:', suggestedDate);
  if (gradDate === null) return; // cancelled
  const gradTime = prompt('Hora de la graduación (hora Colombia):', suggestedTime);
  if (gradTime === null) return; // cancelled

  const message = renderTemplate(settings.graduationTemplate || DEFAULT_GRADUATION_TEMPLATE, {
    courseName,
    gradDate,
    gradTime,
    tutorName: settings.tutorName
  });

  await queueGroupBroadcastMessage(message);
}

// Pluralize a Spanish weekday name for recurring-schedule phrasing
// ("domingo" -> "domingos", "sábado" -> "sábados", the rest stay the same:
// "los lunes", "los martes", etc.)
function pluralizeSpanishDay(dayName) {
  const lower = (dayName || '').toLowerCase();
  if (lower === 'sábado' || lower === 'sabado') return 'sábados';
  if (lower === 'domingo') return 'domingos';
  return lower;
}

// Build a natural-language recurring schedule line from a lesson's ISO
// date, e.g. "Domingos a las 8:00 a.m. (hora Colombia)"
function buildScheduleLine(isoDateStr) {
  if (!isoDateStr) return null;
  try {
    const date = new Date(isoDateStr);
    const dayNameRaw = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'America/Bogota' }).format(date);
    const pluralDay = pluralizeSpanishDay(dayNameRaw);
    const capitalizedDay = pluralDay.charAt(0).toUpperCase() + pluralDay.slice(1);
    const time12hRaw = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' }).format(date);
    // Spanish Intl output is "8:00 a. m." - collapse to "8:00 a.m."
    const time12h = time12hRaw.replace(/\s*([ap])\.?\s*m\.?/i, (m, ap) => ` ${ap.toLowerCase()}.m.`);
    return `${capitalizedDay} a las ${time12h} (hora Colombia)`;
  } catch (error) {
    console.warn('[buildScheduleLine] Error formatting date:', error);
    return null;
  }
}

async function sendGroupWelcomeBroadcast() {
  const courseName = findCourseName() || 'tu curso';
  const settings = getExtensionSettings();

  const message = renderTemplate(settings.groupWelcomeTemplate || DEFAULT_GROUP_WELCOME_TEMPLATE, {
    courseName,
    tutorName: settings.tutorName
  });

  await queueGroupBroadcastMessage(message);
}

// This runs on every bo.kodland.org page load, independent of group pages.
// Start listening for the auth token immediately, so it's ready by the
// time the tutor lands on a group page.
captureAuthToken();

// ---------------------------------------------------------------------
// Shared DOM watcher
// ---------------------------------------------------------------------
// Two different features used to each run their own MutationObserver on
// the whole document.body - both reacting to literally every mutation on
// the page, with no debounce. On a page with a lot of Vue re-rendering
// (like the student list), that's two full callback passes per tick,
// most of which find nothing new. This keeps ONE observer, debounced so a
// burst of mutations from a single re-render only triggers one pass, and
// fans out to whichever features are currently registered.
const domWatchCallbacks = new Set();
let sharedDomObserver = null;
let sharedDomDebounceId = null;

function runDomWatchCallbacks() {
  for (const callback of Array.from(domWatchCallbacks)) {
    try {
      callback();
    } catch (error) {
      console.error('[DOM Watcher] Error in a registered check:', error);
    }
  }
}

function registerDomWatcher(callback) {
  domWatchCallbacks.add(callback);

  if (!sharedDomObserver) {
    sharedDomObserver = new MutationObserver(() => {
      clearTimeout(sharedDomDebounceId);
      sharedDomDebounceId = setTimeout(runDomWatchCallbacks, 200);
    });
    sharedDomObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Run once immediately too, in case the relevant DOM is already there.
  try {
    callback();
  } catch (error) {
    console.error('[DOM Watcher] Error in initial check:', error);
  }
}

function unregisterDomWatcher(callback) {
  domWatchCallbacks.delete(callback);
  if (domWatchCallbacks.size === 0 && sharedDomObserver) {
    sharedDomObserver.disconnect();
    sharedDomObserver = null;
  }
}

function injectBroadcastButtons() {
  if (!isGroupPage()) return;
  if (!getExtensionSettings().showBroadcastButtons) return;
  if (document.getElementById('kodland-broadcast-class-starting')) return;

  const wrapper = getOrCreateToolbar();

  const buttonsConfig = [
    { id: 'kodland-broadcast-first-class', label: '🎉 Primera clase', title: 'Copiar y abrir WhatsApp: bienvenida especial para la primera clase del curso', handler: sendFirstClassBroadcast },
    { id: 'kodland-broadcast-class-starting', label: '📢 Aviso de clase', title: 'Copiar y abrir WhatsApp: aviso de que la clase va a empezar', handler: sendClassStartingBroadcast },
    { id: 'kodland-broadcast-in-class', label: '▶️ Estamos en clase', title: 'Copiar y abrir WhatsApp: aviso de que ya empezó la clase', handler: sendInClassBroadcast },
    { id: 'kodland-broadcast-graduation', label: '🎓 Graduación', title: 'Copiar y abrir WhatsApp: aviso de graduación', handler: sendGraduationBroadcast },
    { id: 'kodland-broadcast-group-welcome', label: '🎉 Bienvenida al grupo', title: 'Copiar y abrir WhatsApp: bienvenida al grupo del curso', handler: sendGroupWelcomeBroadcast },
    { id: 'kodland-broadcast-recording', label: '🎥 Grabación al grupo', title: 'Copiar y abrir WhatsApp: enviar el link de la grabación de la última clase al grupo', handler: sendRecordingBroadcast }
  ];

  buttonsConfig.forEach(cfg => {
    const button = document.createElement('button');
    button.id = cfg.id;
    button.className = 'kodland-broadcast-btn';
    button.innerHTML = cfg.label;
    button.setAttribute('title', cfg.title);

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Open the WhatsApp tab first, synchronously, so the popup blocker
      // still counts this as a direct result of the click - the message
      // gets queued for autopaste a moment later, once it's ready.
      openGroupWhatsApp();
      button.disabled = true;
      try {
        await cfg.handler();
      } catch (error) {
        console.error(`[Broadcast] Error en ${cfg.id}:`, error);
        alert('Ocurrió un error armando el mensaje. Revisa la consola.');
      } finally {
        button.disabled = false;
      }
    });

    wrapper.appendChild(button);
  });

  console.log('[Group Students Info] ✅ Botones de difusión al grupo inyectados');
}

function initGroupStudentsInfo() {
  // Only run on group pages
  if (!isGroupPage()) {
    console.log('[Group Students Info] Not a group page, skipping');
    return;
  }
  
  console.log('[Group Students Info] Initializing on group page');
  
  // (Auth token capture already started globally when the script loaded -
  // no need to call captureAuthToken() again here.)

  // Kick off the group general info fetch as early as possible - it's what
  // auto-detects the WhatsApp chat_link, and backs up the course name and
  // other data used further down. Buttons that need it (WA link button,
  // schedule modal) just re-read the cache once this resolves.
  const initialGroupId = extractGroupId();
  if (initialGroupId) {
    fetchGroupGeneralInfo(initialGroupId);
  }
  
  // All of the following share one toolbar (#kodland-broadcast-buttons)
  // fixed at the top of the page. Order here = left-to-right order there.
  // Each one is wrapped separately so that if one throws, it doesn't take
  // down the rest of init (which previously meant one bad button could
  // silently cancel every button after it - AND the student-row
  // processing scheduled below, since that never got to run either).
  const safeInject = (label, fn) => {
    try {
      fn();
    } catch (error) {
      console.error(`[Group Students Info] Error inyectando "${label}":`, error);
    }
  };

  // Broadcast buttons first (class starting, in class, graduation, group welcome)
  safeInject('broadcast', injectBroadcastButtons);

  // Settings button (always visible, so the tutor can re-enable hidden buttons)
  safeInject('settings', injectSettingsButton);

  // Export contacts
  safeInject('export contacts', injectExportContactsButton);

  // Group grading report
  safeInject('grading report', injectGroupGradingReportButton);

  // WhatsApp group link status/paste button
  safeInject('wa group link', injectWhatsAppGroupLinkButton);

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(processAllStudents, 1000);
    });
  } else {
    setTimeout(processAllStudents, 1000);
  }
  
  // Use the shared DOM watcher to detect when new students are added
  // dynamically (see registerDomWatcher above)
  let intervalId = null;

  const studentWatchCheck = () => {
    // Only process if not already processing
    if (isProcessingStudents) {
      return;
    }
    
    // Check if new student elements were added or if buttons disappeared
    const currentStudents = findStudentElements();
    const unprocessedCount = currentStudents.filter(student => {
      const selector = `.kodland-student-buttons[data-student-id="${student.id}"]`;
      const hasButtons =
        student.container.querySelector(selector) ||
        student.container.querySelector('.kodland-student-buttons');
      return !processedStudents.has(student.id) || !hasButtons;
    }).length;
    
    if (unprocessedCount > 0) {
      console.log(`[Group Students Info] New students detected (${unprocessedCount}), processing...`);
      setTimeout(() => {
        if (!isProcessingStudents) {
          processAllStudents();
        }
      }, 500);
    }
  };

  registerDomWatcher(studentWatchCheck);
  
  // Also try processing periodically for the first 30 seconds, but only if there are unprocessed students
  let attempts = 0;
  const maxAttempts = 20;
  intervalId = setInterval(() => {
    if (!isGroupPage()) {
      clearInterval(intervalId);
      unregisterDomWatcher(studentWatchCheck);
      return;
    }
    
    // Don't process if already processing
    if (isProcessingStudents) {
      return;
    }
    
    attempts++;
    
    const students = findStudentElements();
    const unprocessedCount = students.filter(student => {
      const selector = `.kodland-student-buttons[data-student-id="${student.id}"]`;
      const hasButtons =
        student.container.querySelector(selector) ||
        student.container.querySelector('.kodland-student-buttons');
      return !processedStudents.has(student.id) || !hasButtons;
    }).length;
    
    if (unprocessedCount > 0) {
      console.log(`[Group Students Info] Checking for unprocessed students (${unprocessedCount} found)...`);
      processAllStudents();
    }
    
    // Stop interval only once we've actually found students and processed
    // them all - NOT simply because the current check returned 0 (which
    // can happen while the page is still rendering). Keep retrying until
    // maxAttempts if nothing has been found yet.
    if ((students.length > 0 && unprocessedCount === 0) || attempts >= maxAttempts) {
      console.log('[Group Students Info] Stopping periodic check (all processed or max attempts reached)');
      clearInterval(intervalId);
      unregisterDomWatcher(studentWatchCheck);
    }
  }, 2000);
}

// Initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGroupStudentsInfo);
} else {
  initGroupStudentsInfo();
}

// Export functions for external use
if (typeof window !== 'undefined') {
  window.KodlandGroupStudentsInfo = {
    processAllStudents,
    fetchStudentInfo,
    findStudentElements
  };
}

