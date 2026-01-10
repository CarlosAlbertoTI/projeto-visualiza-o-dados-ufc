const rawData = (function(){
    try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "data/dados_poms_pre_post.csv", false); // synchronous load
        xhr.send(null);
        if (xhr.status !== 200 && xhr.status !== 0) return [];

        const text = xhr.responseText.replace(/^\uFEFF/, "");
        const data = d3.csvParse(text, row => ({
            id: row.id || row.ID || row.Id || "",
            scale: row.scale || row.Scale || row.escala || row.Escala || "",
            modality: row.modality || row.Modality || row.modalidade || row.Modalidade || "",
            pre: row.pre !== undefined ? +String(row.pre).replace(",", ".").trim() : NaN,
            post: row.post !== undefined ? +String(row.post).replace(",", ".").trim() : NaN
        })).filter(d => d.scale && !isNaN(d.pre) && !isNaN(d.post));

        return data;
    } catch (e) {
        console.error("Erro ao carregar CSV:", e);
        return [];
    }
})();
const scales = [...new Set(rawData.map(d => d.scale))]; 
const modalities = [...new Set(rawData.map(d => d.modality))];
const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip");

// Cores das modalidades
const modColors = {
    'Judô': 'var(--color-judo)',
    'Jiu-Jitsu': 'var(--color-jiu)',
    'Muay Thai': 'var(--color-muay)'
};
const getColor = (mod) => modColors[mod] || '#6c757d';

// Update legend for slope chart
const legendContainer = d3.select("#legend-modalities");
modalities.forEach(mod => {
    legendContainer.append("div")
        .style("color", getColor(mod))
        .html(`${mod} (Média)`);
});

// --- 1. TMD CHART (DENSITY) ---
function initTMD() {
    const container = d3.select("#chart-tmd");
    const width = container.node().getBoundingClientRect().width;
    const height = 350;
    const margin = {top: 20, right: 30, bottom: 30, left: 40};

    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Calcular TMD real
    const tmdData = [];
    const uniqueIds = [...new Set(rawData.map(d => d.id))];
    
    uniqueIds.forEach(id => {
        const user = rawData.filter(d => d.id === id);
        // Verifica se tem todos os dados necessários
        const hasAllScales = scales.every(s => user.some(u => u.scale === s));
        
        if(hasAllScales) {
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
        }
    });

    // Escala focada na distribuição (Density Plot)
    const x = d3.scaleLinear().domain([80, 160]).range([0, width - margin.left - margin.right]);
    const y = d3.scaleLinear().range([height - margin.top - margin.bottom, 0]);

    // KDE Logic
    function kernelDensityEstimator(kernel, X) {
        return function(V) { return X.map(x => [x, d3.mean(V, v => kernel(x - v))]); };
    }
    function kernelEpanechnikov(k) { return v => Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0; }
    
    const kde = kernelDensityEstimator(kernelEpanechnikov(7), x.ticks(40));
    const densPre = kde(tmdData.map(d => d.pre));
    const densPost = kde(tmdData.map(d => d.post));

    const maxDens = d3.max([...densPre, ...densPost], d => d[1]) || 0.05;
    y.domain([0, maxDens * 1.2]);

    const area = d3.area().curve(d3.curveBasis).x(d => x(d[0])).y0(height - margin.top - margin.bottom).y1(d => y(d[1]));

    svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(d3.axisBottom(x));

    const pathPre = svg.append("path").datum(densPre).attr("fill", "var(--color-pre)").attr("opacity", 0.5).attr("d", area);
    const pathPost = svg.append("path").datum(densPost).attr("fill", "var(--color-highlight)").attr("opacity", 0.7).attr("d", area).attr("opacity", 0);

    return function play() {
        pathPre.attr("opacity", 0).transition().duration(1000).attr("opacity", 0.5);
        pathPost.attr("d", area(densPre)).attr("opacity", 0) 
                .transition().delay(500).duration(1500).ease(d3.easeCubicOut)
                .attr("opacity", 0.7).attr("d", area(densPost));
    };
}

// --- 2. RADAR CHART (AMPLIADO) ---
function initRadar() {
    const container = d3.select("#chart-radar");
    const width = container.node().getBoundingClientRect().width;
    
    // AUMENTAR AINDA MAIS A ALTURA
    const height = 700; // Aumentado para 700px
    
    // Ajuste de margem
    const margin = 50; 
    const radius = Math.min(width, height) / 2 - margin; 
    
    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${width/2},${height/2})`);

    const orderedScales = scales.filter(s => s !== 'Vigor');
    orderedScales.push('Vigor');
    
    const angleSlice = Math.PI * 2 / orderedScales.length;
    
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 18]);

    orderedScales.forEach((s, i) => {
        const angle = i * angleSlice - Math.PI/2;
        const x = Math.cos(angle) * (radius + 30); // Mais espaço para o texto
        const y = Math.sin(angle) * (radius + 30);
        svg.append("line").attr("x2", Math.cos(angle) * radius).attr("y2", Math.sin(angle) * radius).attr("stroke", "#eee");
        
        svg.append("text").attr("x", x).attr("y", y).text(s)
            .attr("text-anchor", "middle")
            .style("font-size", "16px") // Fonte maior (16px)
            .style("font-weight", "600")
            .style("fill", "#495057");
    });
    
    [5, 10, 15].forEach(v => svg.append("circle").attr("r", rScale(v)).attr("fill", "none").attr("stroke", "#f0f0f0").attr("stroke-width", 1.5));

    const meanPre = orderedScales.map(s => d3.mean(rawData.filter(d => d.scale === s), d => d.pre));
    const meanPost = orderedScales.map(s => d3.mean(rawData.filter(d => d.scale === s), d => d.post));
    
    // Ajustar domínio do rScale para realçar variações (reduzindo o máximo para "expandir" visualmente)
    const maxMean = d3.max([...meanPre, ...meanPost]);
    rScale.domain([0, Math.max(10, maxMean * 0.85)]);

    const line = d3.lineRadial().angle((d, i) => i * angleSlice).radius(d => rScale(d)).curve(d3.curveLinearClosed);

    const pathPre = svg.append("path").datum(meanPre).attr("fill", "var(--color-pre)").attr("fill-opacity", 0.3).attr("d", line).attr("stroke", "var(--color-pre)").attr("stroke-width", 1).attr("opacity", 0);
    const pathPost = svg.append("path").datum(meanPost).attr("fill", "var(--color-highlight)").attr("fill-opacity", 0.75).attr("stroke", "#e0a800").attr("stroke-width", 1).attr("d", line).attr("opacity", 0);

    return function play() {
        pathPre.attr("opacity", 0).transition().duration(1000).attr("opacity", 1);
        pathPost.datum(meanPre).attr("d", line).attr("opacity", 0) 
                .transition().delay(800).duration(1500).ease(d3.easeElastic)
                .attr("opacity", 1)
                .attrTween("d", function() {
                    const i = d3.interpolateArray(meanPre, meanPost);
                    return t => line(i(t));
                });
    };
}

// --- 3. DUMBBELL CHART (VERSÃO FINAL "IDEAL") ---
function initDumbbell() {
    const container = d3.select("#chart-dumbbell");
    const width = container.node().getBoundingClientRect().width;
    
    const height = 500; 
    const margin = {top: 20, right: 30, bottom: 30, left: 100};
    
    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const summary = scales.map(s => ({
        scale: s,
        pre: d3.mean(rawData.filter(x => x.scale === s), x => x.pre),
        post: d3.mean(rawData.filter(x => x.scale === s), x => x.post)
    })).sort((a,b) => Math.abs(b.post - b.pre) - Math.abs(a.post - a.pre));

    // Zoom automático baseado no máximo
    const maxVal = d3.max(summary, d => Math.max(d.pre, d.post)) || 10;
    
    const x = d3.scaleLinear().range([0, width - margin.left - margin.right]).domain([0, maxVal * 1.1]);
    const y = d3.scaleBand().range([0, height - margin.top - margin.bottom]).domain(summary.map(d => d.scale)).padding(1);

    // Grid e Eixos
    svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(d3.axisBottom(x));
    svg.append("g").call(d3.axisLeft(y).tickSize(0)).select(".domain").remove();
    svg.selectAll(".tick text").style("font-size", "14px").style("fill", "#212529").style("font-weight", "600");

    svg.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0,${height - margin.top - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(5).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));

    const groups = svg.selectAll("g.dumbbell").data(summary).enter().append("g");
    
    // Linha guia de fundo
    groups.append("line").attr("x1", 0).attr("x2", width).attr("y1", d => y(d.scale)).attr("y2", d => y(d.scale)).attr("stroke", "#f8f9fa").attr("stroke-width", 2);

    // Função auxiliar para determinar cor (Verde = Bom, Vermelho = Ruim)
    const getColorStatus = (d) => {
        const isBadScale = !['Vigor'].includes(d.scale); // Escalas ruins (Tensão, etc)
        const diff = d.post - d.pre;
        // Se escala ruim diminuiu OU escala boa aumentou = VERDE, senão VERMELHO
        return (isBadScale && diff <= 0) || (!isBadScale && diff >= 0) ? "#198754" : "#dc3545";
    };

    // 1. Linha Conectora
    const connectors = groups.append("line")
        .attr("y1", d => y(d.scale)).attr("y2", d => y(d.scale))
        .attr("stroke", d => getColorStatus(d))
        .attr("stroke-width", 4)
        .attr("stroke-opacity", 0.6); // Leve transparência para não brigar com as bolas

    // 2. Bolinha "Pré" (ESTILO FANTASMA/ANEL)
    // Preenchimento branco e borda cinza. Isso permite ver sobreposição.
    const cPre = groups.append("circle").attr("cy", d => y(d.scale)).attr("r", 7)
        .attr("fill", "white") 
        .attr("stroke", "#adb5bd") // Cinza neutro
        .attr("stroke-width", 2);
        
    // 3. Bolinha "Pós" (SÓLIDA E COLORIDA)
    // Agora a bolinha final carrega a cor do status (Verde/Vermelho)
    const cPost = groups.append("circle").attr("cy", d => y(d.scale)).attr("r", 9)
        .attr("fill", d => getColorStatus(d)) 
        .attr("stroke", "white")
        .attr("stroke-width", 2);
    
    // 4. Texto do Valor (COLORIDO)
    const lbl = groups.append("text")
        .attr("y", d => y(d.scale) - 18) 
        .text(d => {
            const val = (d.post-d.pre).toFixed(1);
            return val > 0 ? `+${val}` : val; 
        })
        .attr("text-anchor", "middle")
        .style("font-size", "15px")   
        .style("font-weight", "800") 
        .style("fill", d => getColorStatus(d)); // Texto na mesma cor da bolinha

    // Animação
    return function play() {
        connectors.attr("x1", d => x(d.pre)).attr("x2", d => x(d.pre))
            .transition().duration(1000).delay((d,i) => i*100).attr("x2", d => x(d.post));
        
        cPre.attr("cx", d => x(d.pre)).attr("opacity", 0).transition().duration(500).attr("opacity", 1);
        
        cPost.attr("cx", d => x(d.post)).attr("opacity", 0).transition().delay((d,i)=>800+i*100).duration(500).attr("opacity", 1);
        
        lbl.attr("x", d => (x(d.pre)+x(d.post))/2).attr("opacity", 0).transition().delay(1200).duration(500).attr("opacity", 1);
    };
}

// --- 4. SLOPE CHART ---
function initSlope() {
    const container = d3.select("#chart-slope");
    const width = container.node().getBoundingClientRect().width;
    const height = 400;
    const margin = {top: 20, right: 50, bottom: 30, left: 50};
    const svg = container.append("svg").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    
    const x = d3.scalePoint().domain(['Pré', 'Pós']).range([0, width - margin.left - margin.right]).padding(0.1);
    const y = d3.scaleLinear().range([height - margin.top - margin.bottom, 0]);

    const xAxis = svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(d3.axisBottom(x).tickSize(0));
    xAxis.select(".domain").remove();
    xAxis.selectAll(".tick text").style("font-size", "14px").style("font-weight", "bold");
    
    const yAxis = svg.append("g");

    const lineGroup = svg.append("g");
    
    function update(selectedScale, animate=true) {
        const data = rawData.filter(d => d.scale === selectedScale);
        const means = modalities.map(mod => ({
            modality: mod, 
            pre: d3.mean(data.filter(d => d.modality === mod), d => d.pre), 
            post: d3.mean(data.filter(d => d.modality === mod), d => d.post)
        })).filter(d => d.pre !== undefined);

        const maxVal = d3.max(data, d => Math.max(d.pre, d.post));
        y.domain([0, Math.ceil(maxVal * 1.1)]); 

        yAxis.transition().duration(500).call(d3.axisLeft(y).ticks(5));

        svg.selectAll(".grid-line").remove();
        svg.append("g").attr("class", "grid-line grid")
            .call(d3.axisLeft(y).tickSize(-(width - margin.left - margin.right)).tickFormat(""));

        const uLines = lineGroup.selectAll(".ind-line").data(data, d => d.id);
        uLines.enter().append("line").attr("class", "ind-line")
            .attr("stroke", "#e9ecef").attr("stroke-width", 1)
            .merge(uLines)
            .attr("x1", x('Pré')).attr("x2", animate ? x('Pré') : x('Pós'))
            .attr("y1", d => y(d.pre)).attr("y2", d => y(d.pre))
            .transition().duration(animate ? 1500 : 500).delay((d,i) => animate ? i*10 : 0)
            .attr("x2", x('Pós')).attr("y2", d => y(d.post));
        uLines.exit().remove();

        const uMeans = lineGroup.selectAll(".mean-line").data(means);
        uMeans.enter().append("line").attr("class", "mean-line")
            .attr("stroke", d => getColor(d.modality))
            .attr("stroke-width", 4).attr("stroke-linecap", "round")
            .merge(uMeans)
            .attr("x1", x('Pré')).attr("x2", x('Pré'))
            .attr("y1", d => y(d.pre)).attr("y2", d => y(d.pre))
            .transition().duration(1500).delay(500)
            .attr("x2", x('Pós')).attr("y2", d => y(d.post));
        uMeans.exit().remove();
    }

    const sel = d3.select("#scaleSelect");
    sel.selectAll("option").data(scales).enter().append("option").text(d => d).attr("value", d => d);
    sel.on("change", function() { update(this.value, true); });

    return () => update(sel.property("value") || scales[0], true);
}

// --- INICIALIZAÇÃO ---
const playTMD = initTMD();
const playRadar = initRadar();
const playDumbbell = initDumbbell();
const playSlopeFn = initSlope();

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if(entry.isIntersecting) {
            entry.target.classList.add("visible");
            const id = entry.target.id;
            if(id === 'section-tmd') playTMD();
            if(id === 'section-radar') playRadar();
            if(id === 'section-dumbbell') playDumbbell();
            if(id === 'section-slope') playSlopeFn();
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.3 });

document.querySelectorAll('.story-section').forEach(section => observer.observe(section));
