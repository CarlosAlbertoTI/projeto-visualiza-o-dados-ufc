const rawData = (function(){
    try {
        const xhr = new XMLHttpRequest();
        // Carregamento síncrono para garantir dados antes do render
        xhr.open("GET", "data/dados_poms_pre_post.csv", false); 
        xhr.send(null);
        if (xhr.status !== 200 && xhr.status !== 0) return [];

        const text = xhr.responseText.replace(/^\uFEFF/, "");
        const data = d3.csvParse(text, row => ({
            id: row.id || row.ID || "",
            scale: row.scale || row.Scale || row.escala || "",
            modality: row.modality || row.Modality || row.modalidade || "",
            pre: row.pre !== undefined ? +String(row.pre).replace(",", ".").trim() : NaN,
            post: row.post !== undefined ? +String(row.post).replace(",", ".").trim() : NaN
        })).filter(d => d.scale && !isNaN(d.pre) && !isNaN(d.post));

        return data;
    } catch (e) {
        console.error("Erro ao carregar CSV:", e);
        return [];
    }
})();

const scales = ["Tensão", "Depressão", "Raiva", "Fadiga", "Confusão", "Vigor"];
const modalities = [...new Set(rawData.map(d => d.modality))];
const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip");

// Cores
const colorPre = "var(--color-pre)";
const colorPost = "var(--color-highlight)";
const modColors = {
    'Judô': 'var(--color-blue)',
    'Jiu-Jitsu': 'var(--color-red)',
    'Muay Thai': 'var(--color-yellow)'
};
const getModColor = (mod) => modColors[mod] || 'var(--color-gray-light)';

// --- INIT ENROLLMENT (Gráfico de Barras) ---
function initEnrollment() {
    const container = d3.select("#chart-enrollment");
    container.selectAll("*").remove();
    const width = container.node().getBoundingClientRect().width;
    const height = 300;
    const margin = {top: 20, right: 20, bottom: 40, left: 40};

    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const counts = modalities.map(mod => ({
        modality: mod, 
        count: new Set(rawData.filter(d => d.modality === mod).map(d => d.id)).size
    })).sort((a,b) => b.count - a.count);

    const x = d3.scaleBand().range([0, innerW]).domain(counts.map(d => d.modality)).padding(0.4);
    const y = d3.scaleLinear().range([innerH, 0]).domain([0, d3.max(counts, d => d.count) * 1.2]);

    svg.append("g").attr("transform", `translate(0,${innerH})`).call(d3.axisBottom(x)).selectAll("text").style("font-size", "14px").style("font-weight","600");
    svg.append("g").call(d3.axisLeft(y).ticks(5));

    svg.selectAll(".bar")
        .data(counts)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.modality))
        .attr("width", x.bandwidth())
        .attr("y", innerH) 
        .attr("height", 0)
        .attr("fill", d => getModColor(d.modality))
        .attr("rx", 4)
        .transition().duration(1000)
        .attr("y", d => y(d.count))
        .attr("height", d => innerH - y(d.count));

    svg.selectAll(".label")
        .data(counts)
        .enter().append("text")
        .attr("x", d => x(d.modality) + x.bandwidth()/2)
        .attr("y", d => y(d.count) - 8)
        .attr("text-anchor", "middle")
        .style("font-weight", "bold")
        .style("fill", "#212529")
        .text(d => d.count)
        .attr("opacity", 0)
        .transition().delay(800).duration(500).attr("opacity", 1);
}

// --- INIT TMD (Density Plot) ---
function initTMD() {
    const container = d3.select("#chart-tmd");
    container.selectAll("*").remove();
    const width = container.node().getBoundingClientRect().width;
    const height = 400;
    const margin = {top: 20, right: 30, bottom: 50, left: 50};

    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const tmdData = [];
    const uniqueIds = [...new Set(rawData.map(d => d.id))];

    uniqueIds.forEach(id => {
        const user = rawData.filter(d => d.id === id);
        const getVal = (arr, t) => {
            const negs = arr.filter(d => d.scale !== 'Vigor');
            const vig = arr.find(d => d.scale === 'Vigor');
            if(negs.length > 0 && vig) {
                return d3.sum(negs, d => d[t]) - vig[t] + 100;
            }
            return null;
        };
        const preVal = getVal(user, 'pre');
        const postVal = getVal(user, 'post');
        if(preVal !== null && postVal !== null) tmdData.push({ pre: preVal, post: postVal });
    });

    if(tmdData.length === 0) return function(){};

    const allVals = tmdData.flatMap(d => [d.pre, d.post]);
    const xMin = Math.floor(d3.min(allVals) * 0.95);
    const xMax = Math.ceil(d3.max(allVals) * 1.05);

    const x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerW]);
    const y = d3.scaleLinear().range([innerH, 0]);

    function kernelDensityEstimator(kernel, X) {
        return function(V) { return X.map(x => [x, d3.mean(V, v => kernel(x - v))]); };
    }
    function kernelEpanechnikov(k) { return v => Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0; }

    const ticks = x.ticks(40);
    const kde = kernelDensityEstimator(kernelEpanechnikov((xMax - xMin) / 15), ticks);
    const densPre = kde(tmdData.map(d => d.pre));
    const densPost = kde(tmdData.map(d => d.post));

    const maxDens = d3.max([...densPre, ...densPost], d => d[1]) || 0.05;
    y.domain([0, maxDens * 1.1]);

    const area = d3.area().curve(d3.curveBasis).x(d => x(d[0])).y0(innerH).y1(d => y(d[1]));

    svg.append("g").attr("transform", `translate(0,${innerH})`).call(d3.axisBottom(x));
    svg.append("g").call(d3.axisLeft(y).ticks(5));
    svg.append("g").attr("class","grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat("")).selectAll("line").attr("stroke","#f1f3f5");

    const prePath = svg.append("path").datum(densPre)
        .attr("fill", colorPre).attr("fill-opacity", 0.5)
        .attr("stroke", colorPre).attr("stroke-width", 2)
        .attr("d", area).attr("opacity", 0);

    const postPath = svg.append("path").datum(densPost)
        .attr("fill", colorPost).attr("fill-opacity", 0.6)
        .attr("stroke", colorPost).attr("stroke-width", 2)
        .attr("d", area).attr("opacity", 0);

    return function play() {
        prePath.transition().duration(1000).attr("opacity", 1);
        postPath.transition().delay(500).duration(1000).attr("opacity", 1);
    };
}

// --- INIT RADAR & VIGOR (CORRIGIDO) ---
function initRadar() {
    const container = d3.select("#chart-radar");
    container.selectAll("*").remove();
    const width = container.node().getBoundingClientRect().width;
    
    // CORREÇÃO: Aumentar altura e margem para evitar corte das labels
    const height = 450; 
    const margin = 70; // Margem maior para caber texto "Fadiga", "Raiva" etc.
    
    const radius = Math.min(width, height) / 2 - margin; 
    
    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${width/2},${height/2})`);

    const radarScales = scales.filter(s => s !== 'Vigor');
    const angleSlice = Math.PI * 2 / radarScales.length;
    const maxVal = 16; 
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, maxVal]);

    // Grid circular
    [4, 8, 12, 16].forEach(v => {
        svg.append("circle").attr("r", rScale(v)).attr("fill", "none").attr("stroke", "#e9ecef");
        svg.append("text").attr("y", -rScale(v)).text(v).style("font-size","10px").attr("fill","#adb5bd").attr("text-anchor","middle");
    });

    // Eixos e Labels
    radarScales.forEach((s, i) => {
        const angle = i * angleSlice - Math.PI/2; // -PI/2 para começar no topo (12h)
        // Labels um pouco mais afastadas (radius + 25)
        const x = Math.cos(angle) * (radius + 25);
        const y = Math.sin(angle) * (radius + 25);
        
        svg.append("line")
            .attr("x2", Math.cos(angle) * radius)
            .attr("y2", Math.sin(angle) * radius)
            .attr("stroke", "#dee2e6");
            
        svg.append("text")
            .attr("x", x)
            .attr("y", y)
            .text(s)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle") // Ajuda a centralizar verticalmente
            .style("font-size", "13px")
            .style("font-weight", "600");
    });

    const meanPre = radarScales.map(s => d3.mean(rawData.filter(d => d.scale === s), d => d.pre));
    const meanPost = radarScales.map(s => d3.mean(rawData.filter(d => d.scale === s), d => d.post));
    
    const line = d3.areaRadial()
        .angle((d, i) => i * angleSlice)
        .innerRadius(0)
        .outerRadius(d => rScale(d))
        .curve(d3.curveLinearClosed);

    const pathPre = svg.append("path").datum(meanPre).attr("fill", colorPre).attr("fill-opacity", 0.3).attr("stroke", colorPre).attr("stroke-width", 2).attr("d", line).attr("opacity",0);
    const pathPost = svg.append("path").datum(meanPost).attr("fill", colorPost).attr("fill-opacity", 0.5).attr("stroke", colorPost).attr("stroke-width", 2).attr("d", line).attr("opacity",0);

    // Vigor Bar Chart (Separado)
    const vigorContainer = d3.select("#chart-vigor");
    vigorContainer.html(""); 

    const vPre = d3.mean(rawData.filter(d => d.scale === 'Vigor'), d => d.pre);
    const vPost = d3.mean(rawData.filter(d => d.scale === 'Vigor'), d => d.post);
    const vMax = Math.max(vPre, vPost, 16); 

    const createBar = (val, color, label) => {
        const group = vigorContainer.append("div").attr("class", "vigor-bar-group");
        group.append("div").attr("class", "vigor-value").style("color", color).text("0");
        group.append("div").attr("class", "vigor-bar").style("height", "0px").style("background-color", color);
        group.append("div").attr("class", "vigor-label").text(label);
        return group;
    };
    const gPre = createBar(vPre, colorPre, "Pré");
    const gPost = createBar(vPost, colorPost, "Pós");

    return function play() {
        pathPre.transition().duration(1000).attr("opacity", 1);
        pathPost.transition().delay(500).duration(1000).attr("opacity", 1);

        const hScale = (v) => (v / vMax) * 150;
        gPre.select(".vigor-bar").transition().duration(1000).style("height", hScale(vPre) + "px");
        gPre.select(".vigor-value").transition().duration(1000).tween("text", function() { const i = d3.interpolateNumber(0, vPre); return function(t) { this.textContent = i(t).toFixed(1); }; });
        gPost.select(".vigor-bar").transition().delay(500).duration(1000).style("height", hScale(vPost) + "px");
        gPost.select(".vigor-value").transition().delay(500).duration(1000).tween("text", function() { const i = d3.interpolateNumber(0, vPost); return function(t) { this.textContent = i(t).toFixed(1); }; });
    };
}

// --- INIT DUMBBELL ---
function initDumbbell() {
    const container = d3.select("#chart-dumbbell");
    container.selectAll("*").remove();
    const width = container.node().getBoundingClientRect().width;
    const height = 500; 
    const margin = {top: 20, right: 30, bottom: 30, left: 75};
    
    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const summary = scales.map(s => ({
        scale: s,
        pre: d3.mean(rawData.filter(x => x.scale === s), x => x.pre),
        post: d3.mean(rawData.filter(x => x.scale === s), x => x.post)
    })).sort((a,b) => (b.post+b.pre) - (a.post+a.pre));

    const maxVal = d3.max(summary, d => Math.max(d.pre, d.post)) * 1.2;
    const x = d3.scaleLinear().range([0, width - margin.left - margin.right]).domain([0, maxVal]);
    const y = d3.scaleBand().range([0, height - margin.top - margin.bottom]).domain(summary.map(d => d.scale)).padding(1);

    svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(d3.axisBottom(x));
    svg.append("g").call(d3.axisLeft(y).tickSize(0)).select(".domain").remove();
    svg.append("g").attr("class", "grid").call(d3.axisBottom(x).tickSize(height - margin.top - margin.bottom).tickFormat("")).attr("opacity",0.1);

    const groups = svg.selectAll("g.dumbbell").data(summary).enter().append("g");
    groups.append("line").attr("x1", 0).attr("x2", width - margin.left - margin.right).attr("y1", d => y(d.scale)).attr("y2", d => y(d.scale)).attr("stroke", "#f0f0f0");

    const getColorStatus = (d) => {
        const diff = d.post - d.pre;
        if(d.scale === 'Vigor') return diff > 0 ? "var(--color-green)" : "var(--color-red)";
        return diff < 0 ? "var(--color-green)" : "var(--color-red)";
    };

    const connector = groups.append("line")
        .attr("y1", d => y(d.scale)).attr("y2", d => y(d.scale))
        .attr("stroke", d => getColorStatus(d)).attr("stroke-width", 4).attr("stroke-opacity",0.5);

    const cPre = groups.append("circle").attr("cy", d => y(d.scale)).attr("r", 6).attr("fill", "white").attr("stroke", "#adb5bd").attr("stroke-width", 2);
    const cPost = groups.append("circle").attr("cy", d => y(d.scale)).attr("r", 8).attr("fill", d => getColorStatus(d)).attr("stroke", "white").attr("stroke-width", 2);

    return function play() {
        connector.attr("x1", d => x(d.pre)).attr("x2", d => x(d.pre)).transition().duration(1000).attr("x2", d => x(d.post));
        cPre.attr("cx", d => x(d.pre)).attr("opacity",0).transition().duration(500).attr("opacity",1);
        cPost.attr("cx", d => x(d.post)).attr("opacity",0).transition().delay(800).duration(500).attr("opacity",1);
    };
}

// --- INIT SLOPE GRID ---
function initSlope() {
    const container = d3.select("#slope-grid");
    container.html(""); 
    const controls = d3.select("#slope-controls");
    controls.html(""); 
    
    // Add Buttons
    const filters = ["Todos", ...modalities];
    let currentFilter = "Todos";

    filters.forEach(filter => {
        controls.append("button")
            .attr("class", `modality-btn ${filter === 'Todos' ? 'active' : ''}`)
            .text(filter)
            .on("click", function() {
                controls.selectAll(".modality-btn").classed("active", false);
                d3.select(this).classed("active", true);
                currentFilter = filter;
                updateHighlight();
            });
    });

    // Draw Grid
    scales.forEach(scaleName => {
        const wrapper = container.append("div").attr("class", "slope-item");
        wrapper.append("div").attr("class", "slope-title").text(scaleName);
        
        const width = 300, height = 250;
        const margin = {top: 20, right: 30, bottom: 30, left: 30};
        
        const svg = wrapper.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
        const data = rawData.filter(d => d.scale === scaleName);
        
        const x = d3.scalePoint().domain(['Pré', 'Pós']).range([0, width - margin.left - margin.right]).padding(0.2);
        const y = d3.scaleLinear().domain([0, 18]).range([height - margin.top - margin.bottom, 0]);

        svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(d3.axisBottom(x).tickSize(0)).select(".domain").remove();
        svg.selectAll(".tick text").style("font-weight", "bold").style("fill", "#6c757d");
        
        // Gradient Defs
        const defs = svg.append("defs");
        const gradientId = `grad-${scaleName.replace(/\s+/g, '')}`;
        const gradient = defs.append("linearGradient").attr("id", gradientId).attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "0%");
        gradient.append("stop").attr("offset", "0%").attr("stop-color", colorPre);       
        gradient.append("stop").attr("offset", "100%").attr("stop-color", colorPost);    

        svg.selectAll(".slope-line")
            .data(data).enter().append("line").attr("class", "slope-line")
            .attr("data-modality", d => d.modality)
            .attr("x1", x('Pré')).attr("x2", x('Pós')).attr("y1", d => y(d.pre)).attr("y2", d => y(d.post))
            .attr("stroke", `url(#${gradientId})`).attr("stroke-width", 1.5).attr("opacity", 0.6);
            
        svg.selectAll(".dot-pre").data(data).enter().append("circle").attr("class", "slope-dot")
            .attr("data-modality", d => d.modality)
            .attr("cx", x('Pré')).attr("cy", d => y(d.pre)).attr("r", 2.5).attr("fill", colorPre).attr("opacity", 0.6);
            
        svg.selectAll(".dot-post").data(data).enter().append("circle").attr("class", "slope-dot")
            .attr("data-modality", d => d.modality)
            .attr("cx", x('Pós')).attr("cy", d => y(d.post)).attr("r", 2.5).attr("fill", colorPost).attr("opacity", 0.6);
    });

    function updateHighlight() {
        if(currentFilter === 'Todos') {
            d3.selectAll(".slope-line, .slope-dot").transition().duration(300).attr("opacity", 0.6);
        } else {
            d3.selectAll(".slope-line, .slope-dot").transition().duration(300).attr("opacity", 0.05); 
            d3.selectAll(`.slope-line[data-modality="${currentFilter}"], .slope-dot[data-modality="${currentFilter}"]`)
                .transition().duration(300).attr("opacity", 1); 
        }
    }
}

// --- MAIN INIT ---
document.addEventListener("DOMContentLoaded", () => {
    initEnrollment(); 
    initSlope(); 
    
    const playTMD = initTMD();
    const playRadar = initRadar();
    const playDumbbell = initDumbbell();

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if(entry.isIntersecting) {
                entry.target.classList.add("visible");
                if(entry.target.id === 'section-tmd') playTMD();
                if(entry.target.id === 'section-radar') playRadar();
                if(entry.target.id === 'section-dumbbell') playDumbbell();
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.2 });

    document.querySelectorAll('.fade-section').forEach(s => observer.observe(s));
});